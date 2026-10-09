import { RedisClient } from "bun";
import type FailedJobService from "./failedJobService";
import type { Job, Queue } from "./index";
import { jobRegistry } from "./jobRegistry";
import { parseQueueJobEnvelope, type QueueJobEnvelope, runQueueJob } from "./jobRunner";
import { readQueueVisibilityMs } from "./queueConfig";
import { defaultQueueKeys, queueKeyForPriority } from "./redisQueueKeys";

const STREAM_GROUP = "strata-workers-v1";
function streamQueueKey(queueKey: string): string {
  return `${queueKey}:stream`;
}
function streamDeadLetterKey(queueKey: string): string {
  return `${streamQueueKey(queueKey)}:invalid`;
}

function streamRetryKey(queueKey: string): string {
  return `${streamQueueKey(queueKey)}:retries`;
}

interface StreamsEnqueueOptions {
  /** Total lifetime including time waiting and retries, measured from Redis server time. */
  timeoutMs?: number;
}
const MAX_TIMER_MS = 2147483647;
async function readStreamTime(client: RedisClient): Promise<number> {
  const value = await client.send("TIME", []);
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "string" ||
    typeof value[1] !== "string" ||
    !/^\d+$/.test(value[0]) ||
    !/^\d+$/.test(value[1])
  )
    throw new Error("Invalid Redis TIME response");
  const seconds = Number(value[0]);
  const micros = Number(value[1]);
  const now = seconds * 1000 + Math.floor(micros / 1000);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    !Number.isSafeInteger(micros) ||
    micros < 0 ||
    micros >= 1000000 ||
    !Number.isSafeInteger(now)
  )
    throw new Error("Invalid Redis TIME response");
  return now;
}
// Long deadlines use bounded timers; each wakeup rechecks the authoritative server clock.
function watchStreamDeadline(
  client: RedisClient,
  deadlineAtMs: number,
  remainingMs: number,
  expire: () => void,
  fail: (error: unknown) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (remaining: number) => {
    timer = setTimeout(
      () => {
        void (async () => {
          try {
            const remaining = deadlineAtMs - (await readStreamTime(client));
            if (stopped) return;
            if (remaining <= 0) expire();
            else schedule(remaining);
          } catch (error) {
            if (!stopped) fail(error);
          }
        })();
      },
      Math.max(1, Math.min(MAX_TIMER_MS, remaining)),
    );
  };
  schedule(remainingMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// The entire next envelope is the sorted-set member; no orphan payload hash is needed.
// Fence ownership, preflight types, then persist before removing the source reservation.
const SCHEDULE_RETRY = `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 or pending[1][2] ~= ARGV[3] or tonumber(pending[1][3]) >= tonumber(ARGV[4]) then return 0 end
local kind = redis.call('TYPE', KEYS[2]).ok
if kind ~= 'none' and kind ~= 'zset' then return redis.error_reply('Invalid stream retry key type') end
local now = redis.call('TIME')
local due = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000) + tonumber(ARGV[5])
if ARGV[7] ~= '' then due = math.min(due, tonumber(ARGV[7])) end
redis.call('ZADD', KEYS[2], due, ARGV[6])
redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
redis.call('XDEL', KEYS[1], ARGV[2])
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[3]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[3]) end
return 1
`;
const PROMOTE_RETRIES = `
local kinds = {'stream','zset'}
for i=1,2 do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= kinds[i] then return redis.error_reply('Invalid stream retry promotion key type') end
end
local now = redis.call('TIME')
local due = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000)
local entries = redis.call('ZRANGE', KEYS[2], '-inf', due, 'BYSCORE', 'LIMIT', 0, 100)
for _, payload in ipairs(entries) do
  redis.call('XADD', KEYS[1], '*', 'payload', payload)
  redis.call('ZREM', KEYS[2], payload)
end
return #entries
`;
async function scheduleStreamRetry(
  client: RedisClient,
  key: string,
  reservation: StreamReservation,
  envelope: QueueJobEnvelope,
  delayMs: number,
): Promise<void> {
  // Keep server timestamp arithmetic exact, including its epoch component.
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > Number.MAX_SAFE_INTEGER / 2)
    throw new Error("Invalid Streams retry delay");
  const scheduled = await client.send("EVAL", [
    SCHEDULE_RETRY,
    "2",
    streamQueueKey(key),
    streamRetryKey(key),
    STREAM_GROUP,
    reservation.id,
    reservation.owner,
    String(readQueueVisibilityMs()),
    String(delayMs),
    JSON.stringify(envelope),
    envelope.deadlineAtMs === undefined ? "" : String(envelope.deadlineAtMs),
  ]);
  if (Number(scheduled) !== 1) throw new Error("Queue lease lost while scheduling retry");
}
async function promoteStreamRetries(client: RedisClient, key: string): Promise<number> {
  return Number(
    await client.send("EVAL", [PROMOTE_RETRIES, "2", streamQueueKey(key), streamRetryKey(key)]),
  );
}
async function readStreamQueueDepth(client: RedisClient, key: string): Promise<number> {
  // An atomic snapshot avoids double-counting during promotion or scheduling.
  return Number(
    await client.send("EVAL", [
      "return redis.call('XLEN', KEYS[1]) + redis.call('ZCARD', KEYS[2])",
      "2",
      streamQueueKey(key),
      streamRetryKey(key),
    ]),
  );
}

type StreamReservation = { id: string; owner: string; payload: string };

// Never mix old writers/workers with Streams. Maintenance conversion handles old state.
const ASSERT_DRAINED = `
if redis.call('LLEN', KEYS[1]) > 0 or redis.call('LLEN', KEYS[2]) > 0 or redis.call('HLEN', KEYS[3]) > 0 then
  return redis.error_reply('Legacy queue state requires maintenance conversion before Streams activation')
end
return 1
`;
async function assertLegacyDrained(client: RedisClient, key: string): Promise<void> {
  await client.send("EVAL", [
    ASSERT_DRAINED,
    "3",
    key,
    `${key}:processing`,
    `${key}:processing:leases`,
  ]);
}

// XPENDING owner+idle fencing prevents an expired owner from renewing or acknowledging.
// Validate the quarantine destination before writing: Lua command errors do not roll back.
const UPDATE_STREAM = `
local pending = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
if #pending == 0 or pending[1][2] ~= ARGV[3] or tonumber(pending[1][3]) >= tonumber(ARGV[4]) then return 0 end
if ARGV[5] == 'renew' then
  local claimed = redis.call('XCLAIM', KEYS[1], ARGV[1], ARGV[3], 0, ARGV[2], 'JUSTID')
  return #claimed
end
if ARGV[5] == 'quarantine' then
  local kind = redis.call('TYPE', KEYS[2]).ok
  if kind ~= 'none' and kind ~= 'stream' then return redis.error_reply('Invalid stream quarantine key type') end
  redis.call('XADD', KEYS[2], '*', 'sourceId', ARGV[2], 'payload', ARGV[6])
end
local acknowledged = redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
if acknowledged == 1 then redis.call('XDEL', KEYS[1], ARGV[2]) end
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[3]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[3]) end
return acknowledged
`;

// Capture only the bounded scan window so dead consumers can be cleaned without XINFO scans.
const CLAIM_STREAM = `
local window = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[4], '+', 10)
local claimed = redis.call('XAUTOCLAIM', KEYS[1], ARGV[1], ARGV[2], ARGV[3], ARGV[4], 'COUNT', 1)
for _, entry in ipairs(window) do
  if entry[2] ~= ARGV[2] and #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, entry[2]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], entry[2]) end
end
if #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2]) end
return claimed
`;
const READ_STREAM = `
local entries = redis.call('XREADGROUP', 'GROUP', ARGV[1], ARGV[2], 'COUNT', 1, 'STREAMS', KEYS[1], '>')
if not entries and #redis.call('XPENDING', KEYS[1], ARGV[1], '-', '+', 1, ARGV[2]) == 0 then redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2]) end
return entries
`;

async function ensureStreamGroup(client: RedisClient, key: string): Promise<void> {
  await assertLegacyDrained(client, key);
  try {
    await client.send("XGROUP", ["CREATE", streamQueueKey(key), STREAM_GROUP, "0", "MKSTREAM"]);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
  }
}

function readStreamEntry(value: unknown, owner: string): StreamReservation | null {
  if (!Array.isArray(value) || typeof value[0] !== "string" || !Array.isArray(value[1]))
    throw new Error("Invalid Redis stream entry response");
  const fields = value[1];
  let payload: string | undefined;
  for (let index = 0; index < fields.length; index += 2) {
    if (fields[index] === "payload" && typeof fields[index + 1] === "string")
      payload = fields[index + 1];
  }
  // Missing envelope fields are quarantined by the same worker path as malformed JSON.
  return { id: value[0], owner, payload: payload ?? "" };
}

async function updateStreamReservation(
  client: RedisClient,
  key: string,
  reservation: StreamReservation,
  action: "renew" | "ack" | "quarantine",
): Promise<boolean> {
  return (
    Number(
      await client.send("EVAL", [
        UPDATE_STREAM,
        "2",
        streamQueueKey(key),
        streamDeadLetterKey(key),
        STREAM_GROUP,
        reservation.id,
        reservation.owner,
        String(readQueueVisibilityMs()),
        action,
        reservation.payload,
      ]),
    ) === 1
  );
}

async function reserveStreamJob(
  client: RedisClient,
  key: string,
  owner: string,
  cursor = "0-0",
): Promise<{ reservation: StreamReservation | null; cursor: string }> {
  // COUNT 1 bounds Redis's pending scan; retain its cursor across polling cycles.
  const claimed = await client.send("EVAL", [
    CLAIM_STREAM,
    "1",
    streamQueueKey(key),
    STREAM_GROUP,
    owner,
    String(readQueueVisibilityMs()),
    cursor,
  ]);
  if (!Array.isArray(claimed) || typeof claimed[0] !== "string" || !Array.isArray(claimed[1]))
    throw new Error("Invalid Redis XAUTOCLAIM response");
  const nextCursor = claimed[0];
  if (claimed[1].length > 0)
    return { reservation: readStreamEntry(claimed[1][0], owner), cursor: nextCursor };
  const fresh = await client.send("EVAL", [
    READ_STREAM,
    "1",
    streamQueueKey(key),
    STREAM_GROUP,
    owner,
  ]);
  if (fresh === null) return { reservation: null, cursor: nextCursor };
  if (!Array.isArray(fresh) || !Array.isArray(fresh[0]) || !Array.isArray(fresh[0][1]))
    throw new Error("Invalid Redis XREADGROUP response");
  return { reservation: readStreamEntry(fresh[0][1][0], owner), cursor: nextCursor };
}

class RedisStreamsQueue implements Queue {
  private readonly client: RedisClient;
  constructor(redisUrl: string) {
    this.client = new RedisClient(redisUrl);
  }
  close(): void {
    this.client.close();
  }
  async dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void> {
    await this.enqueue(job, payload);
  }
  async enqueue<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    options: StreamsEnqueueOptions = {},
  ): Promise<string> {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs <= 0 ||
        options.timeoutMs > MAX_TIMER_MS)
    )
      throw new Error("Streams timeoutMs must be an integer between 1 and 2147483647");
    const name = jobRegistry.resolveName(job);
    if (!name) throw new Error("Job is not registered with the queue worker registry.");
    const key = queueKeyForPriority(job.priority);
    await assertLegacyDrained(this.client, key);
    const jobId = `${streamQueueKey(key)}/${crypto.randomUUID()}`;
    const deadlineAtMs =
      options.timeoutMs === undefined
        ? undefined
        : (await readStreamTime(this.client)) + options.timeoutMs;
    await this.client.send("XADD", [
      streamQueueKey(key),
      "*",
      "payload",
      JSON.stringify({
        name,
        payload,
        attempts: 0,
        jobId,
        deadlineAtMs,
      }),
    ]);
    return jobId;
  }
}

class RedisStreamsWorker {
  private readonly client: RedisClient;
  private readonly owner = crypto.randomUUID();
  private readonly cursors = new Map<string, string>();
  private processing = false;
  private initialized = false;
  private running = false;
  private stopping = false;
  private active?: AbortController;
  constructor(
    redisUrl: string,
    private readonly failedJobs: FailedJobService,
    private readonly timeoutSeconds = 5,
    private readonly queueKeys: readonly string[] = defaultQueueKeys(),
  ) {
    readQueueVisibilityMs();
    this.client = new RedisClient(redisUrl);
  }
  requestStop(): void {
    this.stopping = true;
  }
  isRunning(): boolean {
    return this.running;
  }
  close(): void {
    this.stopping = true;
    this.active?.abort(new Error("Queue worker closed"));
    this.client.close();
  }
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const key of this.queueKeys) await ensureStreamGroup(this.client, key);
    this.initialized = true;
  }
  private async reserve(key: string): Promise<StreamReservation | null> {
    await promoteStreamRetries(this.client, key);
    const result = await reserveStreamJob(this.client, key, this.owner, this.cursors.get(key));
    this.cursors.set(key, result.cursor);
    return result.reservation;
  }
  async processNext(): Promise<boolean> {
    if (this.processing) throw new Error("Queue worker already processing a job.");
    this.processing = true;
    try {
      return await this.processOne();
    } finally {
      this.processing = false;
    }
  }
  private async processOne(): Promise<boolean> {
    if (this.stopping) return false;
    await this.initialize();
    const deadline = performance.now() + this.timeoutSeconds * 1000;
    do {
      for (const key of this.queueKeys) {
        if (this.stopping) return false;
        const reservation = await this.reserve(key);
        if (!reservation) continue;
        await this.handle(key, reservation);
        return true;
      }
      if (performance.now() >= deadline || this.stopping) return false;
      await Bun.sleep(Math.min(100, Math.max(1, deadline - performance.now())));
    } while (!this.stopping);
    return false;
  }
  private async handle(key: string, reservation: StreamReservation): Promise<void> {
    const envelope = parseQueueJobEnvelope(reservation.payload);
    if (!envelope) {
      await updateStreamReservation(this.client, key, reservation, "quarantine");
      return;
    }
    envelope.jobId ??= `${streamQueueKey(key)}/${reservation.id}`;
    const remainingMs =
      envelope.deadlineAtMs === undefined
        ? undefined
        : envelope.deadlineAtMs - (await readStreamTime(this.client));
    const deadlineError = new Error("Streams job deadline exceeded");
    if (remainingMs !== undefined && remainingMs <= 0) {
      await this.failedJobs.recordFailure({
        jobName: envelope.name,
        payload: envelope.payload,
        exception: deadlineError.message,
      });
      await updateStreamReservation(this.client, key, reservation, "ack");
      return;
    }
    const controller = new AbortController();
    this.active = controller;
    let acknowledge = false;
    let released = false;
    let ownershipLost = false;
    let renewal: Promise<void> | undefined;
    let deadlineExpired = false;
    let failureRecorded = false;
    const loseOwnership = (error: unknown) => {
      ownershipLost = true;
      controller.abort(error);
    };
    const stopDeadlineWatch =
      remainingMs === undefined || envelope.deadlineAtMs === undefined
        ? undefined
        : watchStreamDeadline(
            this.client,
            envelope.deadlineAtMs,
            remainingMs,
            () => {
              deadlineExpired = true;
              controller.abort(deadlineError);
            },
            loseOwnership,
          );
    const heartbeat = setInterval(
      () => {
        if (renewal || ownershipLost || released) return;
        renewal = (async () => {
          try {
            if (!(await updateStreamReservation(this.client, key, reservation, "renew")))
              loseOwnership(new Error("Queue lease lost"));
          } catch (error) {
            loseOwnership(error);
            console.error("[StreamsWorker] Lease renewal failed:", error);
          }
        })().finally(() => {
          renewal = undefined;
        });
      },
      Math.max(1, Math.floor(readQueueVisibilityMs() / 3)),
    );
    try {
      await runQueueJob(envelope, this.failedJobs, {
        context: {
          jobId: envelope.jobId,
          signal: controller.signal,
          deadlineAtMs: envelope.deadlineAtMs,
        },
        deferRetry: async (next, delayMs) => {
          controller.signal.throwIfAborted();
          await scheduleStreamRetry(this.client, key, reservation, next, delayMs);
          released = true;
        },
        onFailureRecorded: () => {
          acknowledge = true;
          failureRecorded = true;
        },
      });
      acknowledge = true;
    } catch (error) {
      console.error("[StreamsWorker] Job failed:", error);
    } finally {
      stopDeadlineWatch?.();
      clearInterval(heartbeat);
      await renewal;
      this.active = undefined;
    }
    if (
      !ownershipLost &&
      !released &&
      envelope.deadlineAtMs !== undefined &&
      (deadlineExpired || envelope.deadlineAtMs <= (await readStreamTime(this.client)))
    ) {
      if (!failureRecorded)
        await this.failedJobs.recordFailure({
          jobName: envelope.name,
          payload: envelope.payload,
          exception: deadlineError.message,
        });
      acknowledge = true;
    }
    if (acknowledge && !ownershipLost && !released)
      await updateStreamReservation(this.client, key, reservation, "ack");
  }
  async run(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopping) await this.processNext();
    } finally {
      this.running = false;
    }
  }
}

// Maintenance only. Copy a bounded FIFO batch into Streams before deleting its source.
// Redis TIME/XADD identities persist across workers; the SQL failed_job table is retained.
const CONVERT_LIST = `
local kinds = {'list','list','hash','stream'}
for i=1,4 do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= kinds[i] then return redis.error_reply('Invalid queue conversion key type') end
end
if redis.call('LLEN', KEYS[2]) > 0 or redis.call('HLEN', KEYS[3]) > 0 then return redis.error_reply('Drain or recover processing reservations before queue conversion') end
local converted = 0
for i=1,tonumber(ARGV[1]) do
  local payload = redis.call('LINDEX', KEYS[1], -1)
  if not payload then break end
  redis.call('XADD', KEYS[4], '*', 'payload', payload)
  redis.call('RPOP', KEYS[1])
  converted = converted + 1
end
return converted
`;
async function migrateLegacyQueueToStreams(
  client: RedisClient,
  options: { maintenance: true; batchSize?: number; queueKeys?: readonly string[] },
): Promise<number> {
  if (options.maintenance !== true)
    throw new Error(
      "Queue conversion requires maintenance mode: stop all producers and workers first.",
    );
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error("Queue conversion batchSize must be between 1 and 1000.");
  let converted = 0;
  for (const key of options.queueKeys ?? defaultQueueKeys())
    converted += Number(
      await client.send("EVAL", [
        CONVERT_LIST,
        "4",
        key,
        `${key}:processing`,
        `${key}:processing:leases`,
        streamQueueKey(key),
        String(batchSize),
      ]),
    );
  return converted;
}

export type { StreamReservation, StreamsEnqueueOptions };
// Internal protocol helpers, not exported as a package subpath.
export {
  ensureStreamGroup,
  migrateLegacyQueueToStreams,
  promoteStreamRetries,
  RedisStreamsQueue,
  RedisStreamsWorker,
  readStreamEntry,
  readStreamQueueDepth,
  readStreamTime,
  reserveStreamJob,
  STREAM_GROUP,
  scheduleStreamRetry,
  streamDeadLetterKey,
  streamQueueKey,
  streamRetryKey,
  updateStreamReservation,
  watchStreamDeadline,
};
