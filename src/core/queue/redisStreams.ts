import { RedisClient } from "bun";
import type FailedJobService from "./failedJobService";
import type { Job, Queue } from "./index";
import { jobRegistry } from "./jobRegistry";
import { parseQueueJobEnvelope, type QueueJobEnvelope, runQueueJob } from "./jobRunner";
import { readQueueVisibilityMs } from "./queueConfig";
import { defaultQueueKeys, queueKeyForPriority } from "./redisQueueKeys";
import {
  ASSERT_DRAINED,
  CANCEL_STREAM,
  CLAIM_STREAM,
  CONVERT_LIST,
  ENQUEUE_CONTROLLED,
  POLL_STREAM_PRIORITIES,
  PROMOTE_RETRIES,
  READ_STREAM,
  SCHEDULE_RETRY,
  UPDATE_STREAM,
} from "./redisStreamsScripts.ts";

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
  cancellable?: boolean;
}
function streamControlKey(key: string, jobId: string): string {
  const prefix = `${streamQueueKey(key)}/`;
  if (
    !jobId.startsWith(prefix) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      jobId.slice(prefix.length),
    )
  )
    throw new Error("Invalid cancellable Streams job ID");
  return `${streamQueueKey(key)}:control:${jobId.slice(prefix.length)}`;
}
async function cancelStreamJob(client: RedisClient, key: string, jobId: string): Promise<boolean> {
  return (
    Number(
      await client.send("EVAL", [
        CANCEL_STREAM,
        "2",
        streamControlKey(key, jobId),
        streamRetryKey(key),
      ]),
    ) === 1
  );
}
async function readStreamCancellation(client: RedisClient, controlKey: string): Promise<boolean> {
  const state = await client.send("HGET", [controlKey, "state"]);
  if (state !== "active" && state !== "cancelled")
    throw new Error("Missing or invalid Streams control state");
  return state === "cancelled";
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
    "3",
    streamQueueKey(key),
    streamRetryKey(key),
    envelope.cancellable ? streamControlKey(key, envelope.jobId ?? "") : streamQueueKey(key),
    STREAM_GROUP,
    reservation.id,
    reservation.owner,
    String(readQueueVisibilityMs()),
    String(delayMs),
    JSON.stringify(envelope),
    envelope.deadlineAtMs === undefined ? "" : String(envelope.deadlineAtMs),
    envelope.cancellable ? "1" : "0",
  ]);
  if (Number(scheduled) !== 1) throw new Error("Queue lease lost while scheduling retry");
}
async function promoteStreamRetries(client: RedisClient, key: string): Promise<number> {
  return Number(
    await client.send("EVAL", [PROMOTE_RETRIES, "2", streamQueueKey(key), streamRetryKey(key)]),
  );
}

// One script walks priorities in order: promote due retries, reclaim one idle entry, then read one new entry.
// Idle workers pay one Redis round trip instead of a claim and a read on every priority.

async function pollStreamPriorities(
  client: RedisClient,
  queueKeys: readonly string[],
  owner: string,
  cursors: readonly string[],
): Promise<{
  cursors: string[];
  hit: { index: number; reservation: StreamReservation } | null;
}> {
  const keys: string[] = [];
  for (const key of queueKeys) keys.push(streamQueueKey(key), streamRetryKey(key));
  const raw = await client.send("EVAL", [
    POLL_STREAM_PRIORITIES,
    String(keys.length),
    ...keys,
    STREAM_GROUP,
    owner,
    String(readQueueVisibilityMs()),
    ...cursors,
  ]);
  if (!Array.isArray(raw)) throw new Error("Invalid Redis stream poll response");
  const flag = String(raw[0]);
  const cursorCount = queueKeys.length;
  if (flag === "0") {
    if (raw.length !== cursorCount + 1) throw new Error("Invalid Redis stream poll response");
    return { cursors: raw.slice(1).map(String), hit: null };
  }
  if (flag !== "1" || raw.length !== cursorCount + 4)
    throw new Error("Invalid Redis stream poll response");
  const index = Number(raw[1]);
  if (!Number.isInteger(index) || index < 1 || index > queueKeys.length)
    throw new Error("Invalid Redis stream poll response");
  return {
    cursors: raw.slice(4).map(String),
    hit: {
      index: index - 1,
      reservation: { id: String(raw[2]), owner, payload: String(raw[3]) },
    },
  };
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

// Capture only the bounded scan window so dead consumers can be cleaned without XINFO scans.

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
  controlKey?: string,
): Promise<boolean> {
  return (
    Number(
      await client.send("EVAL", [
        UPDATE_STREAM,
        "3",
        streamQueueKey(key),
        streamDeadLetterKey(key),
        controlKey ?? streamQueueKey(key),
        STREAM_GROUP,
        reservation.id,
        reservation.owner,
        String(readQueueVisibilityMs()),
        action,
        reservation.payload,
        controlKey ? "1" : "0",
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
    return this.admit(job, payload, options);
  }
  async replay<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    jobId: string,
  ): Promise<void> {
    const prefix = defaultQueueKeys().find((key) => jobId.startsWith(`${streamQueueKey(key)}/`));
    if (
      !prefix ||
      !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+-[0-9]+)$/.test(
        jobId.slice(streamQueueKey(prefix).length + 1),
      )
    )
      throw new Error("Replay identity does not belong to this Streams namespace");
    await this.admit(job, payload, {}, jobId);
  }
  private async admit<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    options: StreamsEnqueueOptions,
    replayId?: string,
  ): Promise<string> {
    if (options.cancellable !== undefined && typeof options.cancellable !== "boolean")
      throw new Error("cancellable must be a boolean");
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
    const jobId = replayId ?? `${streamQueueKey(key)}/${crypto.randomUUID()}`;
    const deadlineAtMs =
      options.timeoutMs === undefined
        ? undefined
        : (await readStreamTime(this.client)) + options.timeoutMs;
    const envelope = JSON.stringify({
      name,
      payload,
      attempts: 0,
      jobId,
      deadlineAtMs,
      ...(options.cancellable ? { cancellable: true } : {}),
    });
    if (options.cancellable)
      await this.client.send("EVAL", [
        ENQUEUE_CONTROLLED,
        "2",
        streamQueueKey(key),
        streamControlKey(key, jobId),
        envelope,
      ]);
    else await this.client.send("XADD", [streamQueueKey(key), "*", "payload", envelope]);
    return jobId;
  }
  async cancel(jobId: string): Promise<boolean> {
    const key = defaultQueueKeys().find((key) => jobId.startsWith(`${streamQueueKey(key)}/`));
    if (!key) throw new Error("Invalid cancellable Streams job ID");
    return cancelStreamJob(this.client, key, jobId);
  }
}

class RedisStreamsWorker {
  private client: RedisClient;
  private readonly owner = crypto.randomUUID();
  private readonly cursors = new Map<string, string>();
  private processing = false;
  private initialized = false;
  private running = false;
  private stopping = false;
  private active?: AbortController;
  constructor(
    private readonly redisUrl: string,
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
      if (this.stopping) return false;
      const polled = await pollStreamPriorities(
        this.client,
        this.queueKeys,
        this.owner,
        this.queueKeys.map((key) => this.cursors.get(key) ?? "0-0"),
      );
      this.queueKeys.forEach((key, index) => {
        const cursor = polled.cursors[index];
        if (cursor) this.cursors.set(key, cursor);
      });
      if (polled.hit) {
        const key = this.queueKeys[polled.hit.index];
        if (!key) throw new Error("Invalid Redis stream poll response");
        await this.handle(key, polled.hit.reservation);
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
    let controlKey: string | undefined;
    if (envelope.cancellable) {
      try {
        controlKey = streamControlKey(key, envelope.jobId);
      } catch {
        await updateStreamReservation(this.client, key, reservation, "quarantine");
        return;
      }
    }
    const cancellationError = new Error("Streams job cancelled");
    if (controlKey && (await readStreamCancellation(this.client, controlKey))) {
      await this.failedJobs.recordFailure({
        jobName: envelope.name,
        jobId: envelope.jobId,
        payload: envelope.payload,
        exception: cancellationError.message,
      });
      await updateStreamReservation(this.client, key, reservation, "ack", controlKey);
      return;
    }
    const remainingMs =
      envelope.deadlineAtMs === undefined
        ? undefined
        : envelope.deadlineAtMs - (await readStreamTime(this.client));
    const deadlineError = new Error("Streams job deadline exceeded");
    if (remainingMs !== undefined && remainingMs <= 0) {
      await this.failedJobs.recordFailure({
        jobName: envelope.name,
        jobId: envelope.jobId,
        payload: envelope.payload,
        exception: deadlineError.message,
      });
      await updateStreamReservation(this.client, key, reservation, "ack", controlKey);
      return;
    }
    const controller = new AbortController();
    this.active = controller;
    let acknowledge = false;
    let released = false;
    let ownershipLost = false;
    let renewal: Promise<void> | undefined;
    let deadlineExpired = false;
    let cancellationRequested = false;
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
            if (
              !(await updateStreamReservation(this.client, key, reservation, "renew", controlKey))
            )
              loseOwnership(new Error("Queue lease lost"));
            else if (controlKey && (await readStreamCancellation(this.client, controlKey))) {
              cancellationRequested = true;
              controller.abort(cancellationError);
            }
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
      controlKey &&
      (cancellationRequested || (await readStreamCancellation(this.client, controlKey)))
    ) {
      if (!failureRecorded)
        await this.failedJobs.recordFailure({
          jobName: envelope.name,
          jobId: envelope.jobId,
          payload: envelope.payload,
          exception: cancellationError.message,
        });
      failureRecorded = true;
      acknowledge = true;
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
          jobId: envelope.jobId,
          payload: envelope.payload,
          exception: deadlineError.message,
        });
      acknowledge = true;
    }
    if (acknowledge && !ownershipLost && !released)
      await updateStreamReservation(this.client, key, reservation, "ack", controlKey);
  }
  async run(): Promise<void> {
    this.running = true;
    try {
      while (!this.stopping) {
        try {
          await this.processNext();
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ERR_REDIS_CONNECTION_CLOSED"
            )
          )
            throw error;
          // Never replay an uncertain Redis mutation. Pending reservations/retries
          // remain authoritative and are recovered through the normal protocol.
          this.client.close();
          await Bun.sleep(250);
          if (this.stopping) return;
          this.client = new RedisClient(this.redisUrl);
          this.initialized = false;
          this.cursors.clear();
        }
      }
    } finally {
      this.running = false;
    }
  }
}

// Maintenance only. Copy a bounded FIFO batch into Streams before deleting its source.
// Redis TIME/XADD identities persist across workers; the SQL failed_job table is retained.
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
  cancelStreamJob,
  ensureStreamGroup,
  migrateLegacyQueueToStreams,
  pollStreamPriorities,
  promoteStreamRetries,
  RedisStreamsQueue,
  RedisStreamsWorker,
  readStreamCancellation,
  readStreamEntry,
  readStreamQueueDepth,
  readStreamTime,
  reserveStreamJob,
  STREAM_GROUP,
  scheduleStreamRetry,
  streamControlKey,
  streamDeadLetterKey,
  streamQueueKey,
  streamRetryKey,
  updateStreamReservation,
  watchStreamDeadline,
};
