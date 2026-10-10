import { RedisClient } from "bun";
import { createFailedJobService } from "./createAppQueue";
import { queueConfig, resolveRedisQueueTransport } from "./queueConfig";
import { queueInvalidKey, queueProcessingKey } from "./redisQueue";
import { defaultQueueKeys } from "./redisQueueKeys";
import {
  readStreamQueueDepth,
  STREAM_GROUP,
  streamDeadLetterKey,
  streamQueueKey,
  streamRetryKey,
} from "./redisStreams";

interface QueueDepthMetrics {
  high: number;
  default: number;
  low: number;
  total: number;
}

interface QueueMetricsSnapshot {
  driver: string;
  pending: QueueDepthMetrics;
  failedCount: number;
}

async function readRedisQueueDepth(redisUrl: string): Promise<QueueDepthMetrics> {
  const client = new RedisClient(redisUrl);
  let high: number;
  let defaultQueue: number;
  let low: number;
  try {
    const readDepth = async (key: string) =>
      resolveRedisQueueTransport() === "streams"
        ? readStreamQueueDepth(client, key)
        : client.llen(key);
    [high, defaultQueue, low] = await Promise.all([
      readDepth(defaultQueueKeys()[0]),
      readDepth(defaultQueueKeys()[1]),
      readDepth(defaultQueueKeys()[2]),
    ]);
  } finally {
    client.close();
  }

  return {
    high: Number(high ?? 0),
    default: Number(defaultQueue ?? 0),
    low: Number(low ?? 0),
    total: Number(high ?? 0) + Number(defaultQueue ?? 0) + Number(low ?? 0),
  };
}

async function collectQueueMetrics(): Promise<QueueMetricsSnapshot> {
  const driver = queueConfig.driver;
  const failedJobs = createFailedJobService();
  const failedCount = (await failedJobs.listRecent(1000)).length;

  if (driver !== "redis") {
    return {
      driver,
      pending: {
        high: 0,
        default: 0,
        low: 0,
        total: 0,
      },
      failedCount,
    };
  }

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return {
      driver,
      pending: {
        high: 0,
        default: 0,
        low: 0,
        total: 0,
      },
      failedCount,
    };
  }

  return {
    driver,
    pending: await readRedisQueueDepth(redisUrl),
    failedCount,
  };
}

export type { QueueDepthMetrics, QueueMetricsSnapshot };
export { collectQueueMetrics, readRedisQueueDepth };

interface RedisQueueSnapshotOptions {
  transport?: "lists" | "streams";
  /** One deadline for all three priorities, including connection establishment. */
  timeoutMs?: number;
}
interface QueuePrioritySnapshot {
  priority: "high" | "default" | "low";
  unfinished: number;
  ready: number | null;
  inflight: number;
  inflightCapped: boolean;
  retryDue: number;
  retryWaiting: number;
  /** Oldest positive due-score lateness; unavailable for lists or cancellation sentinels. */
  retryActionableLatenessSeconds?: number | null;
  quarantined: number;
  /** Residence age of the oldest current stream entry, not original job age across retries. */
  oldestStreamEntryAgeSeconds: number | null;
}
interface RedisQueueSnapshot {
  transport: "lists" | "streams";
  priorities: readonly QueuePrioritySnapshot[];
}
const INFLIGHT_SAMPLE_LIMIT = 500;
// Bounded reads only. Never enumerate consumers, jobs, keys or retry payloads.
const STREAM_SNAPSHOT = `
local now = redis.call('TIME')
local ms = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000)
local size = redis.call('XLEN', KEYS[1])
local pending = redis.pcall('XPENDING', KEYS[1], ARGV[1], '-', '+', tonumber(ARGV[2])+1)
if pending.err then
  if not string.find(pending.err, 'NOGROUP', 1, true) then return redis.error_reply(pending.err) end
  pending = {}
end
local capped = #pending > tonumber(ARGV[2]) and 1 or 0
local inflight = math.min(#pending, tonumber(ARGV[2]))
local ready = capped == 1 and -1 or size-inflight
if ready < 0 and capped == 0 then return redis.error_reply('Inconsistent stream pending state') end
local retries = redis.call('ZCARD', KEYS[2])
local due = redis.call('ZCOUNT', KEYS[2], '-inf', ms)
local lateness = 0
if due > 0 then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local score = tonumber(oldest[2])
  if not score or score < 0 or score ~= math.floor(score) or score > ms then
    return redis.error_reply('Invalid retry due score')
  end
  -- Cancellation sets score zero to request immediate promotion/cleanup; it is not a timestamp.
  lateness = score == 0 and -1 or (ms-score)/1000
end
local first = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', 1)
local age = 0
if #first > 0 then
  local timestamp = tonumber(string.match(first[1][1], '^(%d+)-'))
  age = math.max(0, ms-timestamp)/1000
end
return {size+retries, ready, inflight, capped, due, retries-due, redis.call('LLEN', KEYS[3]), tostring(age), tostring(lateness)}
`;
const LIST_SNAPSHOT = `
local ready = redis.call('LLEN', KEYS[1])
local inflight = redis.call('LLEN', KEYS[2])
return {ready+inflight, ready, inflight, 0, 0, 0, redis.call('LLEN', KEYS[3]), '-1', '-1'}
`;

/** Shared state, not per-process counters. Throws on missing configuration, failure or timeout. */
async function readRedisQueueSnapshot(
  redisUrl: string,
  options: RedisQueueSnapshotOptions = {},
): Promise<RedisQueueSnapshot> {
  if (!redisUrl.trim()) throw new TypeError("Queue metrics require a Redis URL.");
  const transport = options.transport ?? resolveRedisQueueTransport();
  if (transport !== "lists" && transport !== "streams")
    throw new TypeError("Invalid queue metrics transport.");
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError("Queue metrics timeout must be between 1 and 5000 milliseconds.");
  const client = new RedisClient(redisUrl, { autoReconnect: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = Promise.all(
      defaultQueueKeys().map(async (key, index): Promise<QueuePrioritySnapshot> => {
        const keys =
          transport === "streams"
            ? [streamQueueKey(key), streamRetryKey(key), streamDeadLetterKey(key)]
            : [key, queueProcessingKey(key), queueInvalidKey(key)];
        const raw = await client.send("EVAL", [
          transport === "streams" ? STREAM_SNAPSHOT : LIST_SNAPSHOT,
          "3",
          ...keys,
          STREAM_GROUP,
          String(INFLIGHT_SAMPLE_LIMIT),
        ]);
        if (!Array.isArray(raw) || raw.length !== 9)
          throw new Error("Invalid queue metrics response.");
        const values = raw.map(Number);
        if (
          values.some((value) => !Number.isFinite(value)) ||
          values
            .slice(0, 7)
            .some((value, i) => !Number.isSafeInteger(value) || value < (i === 1 ? -1 : 0))
        )
          throw new Error("Invalid queue metrics values.");
        const [
          unfinished,
          ready,
          inflight,
          capped,
          retryDue,
          retryWaiting,
          quarantined,
          age,
          lateness,
        ] = values;
        if (
          unfinished === undefined ||
          ready === undefined ||
          inflight === undefined ||
          capped === undefined ||
          retryDue === undefined ||
          retryWaiting === undefined ||
          quarantined === undefined ||
          age === undefined ||
          lateness === undefined ||
          (lateness < 0 && lateness !== -1) ||
          (capped !== 0 && capped !== 1) ||
          age < (transport === "lists" ? -1 : 0)
        )
          throw new Error("Invalid queue metrics values.");
        return {
          priority: index === 0 ? "high" : index === 1 ? "default" : "low",
          unfinished,
          ready: ready === -1 ? null : ready,
          inflight,
          inflightCapped: capped === 1,
          retryDue,
          retryWaiting,
          retryActionableLatenessSeconds: lateness === -1 ? null : lateness,
          quarantined,
          oldestStreamEntryAgeSeconds: transport === "streams" ? age : null,
        };
      }),
    );
    const priorities = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Queue metrics collection timed out.")),
          timeoutMs,
        );
      }),
    ]);
    return { transport, priorities };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    client.close();
  }
}

/** Fixed metric/label vocabulary; no job IDs, tenant IDs, payloads or credentials. */
function renderRedisQueueMetrics(snapshot: RedisQueueSnapshot): string {
  if (
    (snapshot.transport !== "streams" && snapshot.transport !== "lists") ||
    snapshot.priorities.length !== 3 ||
    new Set(snapshot.priorities.map((row) => row.priority)).size !== 3
  )
    throw new TypeError("Invalid queue metrics snapshot.");
  for (const row of snapshot.priorities) {
    if (
      !["high", "default", "low"].includes(row.priority) ||
      typeof row.inflightCapped !== "boolean" ||
      [row.unfinished, row.inflight, row.retryDue, row.retryWaiting, row.quarantined].some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      ) ||
      (row.ready !== null && (!Number.isSafeInteger(row.ready) || row.ready < 0)) ||
      (row.retryActionableLatenessSeconds != null &&
        (!Number.isFinite(row.retryActionableLatenessSeconds) ||
          row.retryActionableLatenessSeconds < 0)) ||
      (row.oldestStreamEntryAgeSeconds !== null &&
        (!Number.isFinite(row.oldestStreamEntryAgeSeconds) || row.oldestStreamEntryAgeSeconds < 0))
    )
      throw new TypeError("Invalid queue metrics snapshot.");
  }
  const lines = [
    "# HELP strata_queue_collector_success Whether the configured queue collection succeeded.",
    "# TYPE strata_queue_collector_success gauge",
    "strata_queue_collector_success 1",
    "# HELP strata_queue_unfinished_jobs Stream/list entries plus scheduled retries, excluding quarantine and persisted failures.",
    "# TYPE strata_queue_unfinished_jobs gauge",
    "# HELP strata_queue_jobs Queue state; inflight_sample is a lower bound when capped.",
    "# TYPE strata_queue_jobs gauge",
    "# HELP strata_queue_inflight_sample_capped Whether the inflight sample was truncated; ready is omitted when truncated.",
    "# TYPE strata_queue_inflight_sample_capped gauge",
    "# HELP strata_queue_oldest_stream_entry_age_seconds Oldest current stream entry residence age; resets when a retry is promoted.",
    "# TYPE strata_queue_oldest_stream_entry_age_seconds gauge",
    "# HELP strata_queue_retry_actionable_lateness_seconds Oldest retry due-score lateness; unavailable for cancellation sentinels or lists.",
    "# TYPE strata_queue_retry_actionable_lateness_seconds gauge",
  ];
  for (const priority of snapshot.priorities) {
    const label = `priority="${priority.priority}"`;
    lines.push(`strata_queue_unfinished_jobs{${label}} ${priority.unfinished}`);
    const states = {
      ready: priority.ready,
      inflight_sample: priority.inflight,
      retry_due: snapshot.transport === "streams" ? priority.retryDue : null,
      retry_waiting: snapshot.transport === "streams" ? priority.retryWaiting : null,
      quarantined: priority.quarantined,
    };
    for (const [state, value] of Object.entries(states))
      if (value !== null) lines.push(`strata_queue_jobs{${label},state="${state}"} ${value}`);
    lines.push(`strata_queue_inflight_sample_capped{${label}} ${Number(priority.inflightCapped)}`);
    if (snapshot.transport === "streams" && priority.retryActionableLatenessSeconds != null)
      lines.push(
        `strata_queue_retry_actionable_lateness_seconds{${label}} ${priority.retryActionableLatenessSeconds}`,
      );
    if (priority.oldestStreamEntryAgeSeconds !== null)
      lines.push(
        `strata_queue_oldest_stream_entry_age_seconds{${label}} ${priority.oldestStreamEntryAgeSeconds}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

export type {
  FailedJobMetricsCollector,
  FailedJobMetricsOptions,
  FailedJobMetricsSnapshot,
} from "./failedJobMetrics";
export { createFailedJobMetricsCollector, renderFailedJobMetrics } from "./failedJobMetrics";
export type { QueuePrioritySnapshot, RedisQueueSnapshot, RedisQueueSnapshotOptions };
export { INFLIGHT_SAMPLE_LIMIT, readRedisQueueSnapshot, renderRedisQueueMetrics };
