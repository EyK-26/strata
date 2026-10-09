import { RedisClient } from "bun";
import type FailedJobService from "./failedJobService";
import type { Job, Queue } from "./index";
import { jobRegistry } from "./jobRegistry";
import { parseQueueJobEnvelope, type QueueJobEnvelope, runQueueJob } from "./jobRunner";
import {
  readQueueVisibilityMs as readVisibilityMs,
  resolveRedisQueueTransport,
} from "./queueConfig";
import {
  defaultQueueKeys,
  QUEUE_HIGH_KEY,
  QUEUE_KEYS,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  queueKeyForPriority,
} from "./redisQueueKeys";
import { readStreamQueueDepth } from "./redisStreams";

function queueProcessingKey(queueKey: string): string {
  return `${queueKey}:processing`;
}

function queueProcessingLeaseKey(queueKey: string): string {
  return `${queueKey}:processing:leases`;
}

function reservationExpired(lease: string | null, now: number, visibilityMs: number): boolean {
  if (lease === null || lease.length === 0) {
    return true;
  }
  const reservedAt = Number(lease);
  if (!Number.isFinite(reservedAt)) {
    return true;
  }
  return now - reservedAt >= visibilityMs;
}

type QueueReservation = { id: string; owner: string; payload: string; record: string };

// Scripts are atomic against other clients, but Redis does not undo writes on a
// script error. Validate key types first, and publish destination state before
// deleting source state so an unexpected command failure cannot erase work.
const SCRIPT_HEADER = `
local function checkType(key, expected)
  local actual = redis.call('TYPE', key).ok
  if actual ~= 'none' and actual ~= expected then
    return redis.error_reply('Unexpected queue key type: ' .. key)
  end
end
local function nowMs()
  local time = redis.call('TIME')
  return tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end
`;

const RESERVE_JOB = `${SCRIPT_HEADER}
local err = checkType(KEYS[1], 'list') or checkType(KEYS[2], 'list') or checkType(KEYS[3], 'hash')
if err then return err end
local payload = redis.call('LINDEX', KEYS[1], -1)
if not payload then return nil end
local record = cjson.encode({strataReservation=1, id=ARGV[1], owner=ARGV[2], payload=payload})
local lease = cjson.encode({owner=ARGV[2], expiresAt=nowMs()+tonumber(ARGV[3])})
redis.call('LPUSH', KEYS[2], record)
redis.call('HSET', KEYS[3], ARGV[1], lease)
redis.call('RPOP', KEYS[1])
return record
`;

const RENEW_OR_ACK = `${SCRIPT_HEADER}
local err = checkType(KEYS[1], 'list') or checkType(KEYS[2], 'hash') or checkType(KEYS[3], 'list')
if err then return err end
local raw = redis.call('HGET', KEYS[2], ARGV[1])
if not raw then return 0 end
local ok, lease = pcall(cjson.decode, raw)
local now = nowMs()
if not ok or type(lease) ~= 'table' or lease.owner ~= ARGV[2] or not tonumber(lease.expiresAt) or tonumber(lease.expiresAt) <= now then
  return 0
end
if ARGV[4] == 'renew' then
  redis.call('HSET', KEYS[2], ARGV[1], cjson.encode({owner=ARGV[2], expiresAt=now+tonumber(ARGV[5])}))
  return 1
end
if ARGV[4] == 'quarantine' then redis.call('LPUSH', KEYS[3], ARGV[6]) end
local removed = redis.call('LREM', KEYS[1], 1, ARGV[3])
redis.call('HDEL', KEYS[2], ARGV[1])
return removed
`;

const RECLAIM_JOBS = `${SCRIPT_HEADER}
local err = checkType(KEYS[1], 'list') or checkType(KEYS[2], 'list') or checkType(KEYS[3], 'hash')
if err then return err end
local now = nowMs()
local reclaimed = 0
for _, record in ipairs(redis.call('LRANGE', KEYS[2], 0, -1)) do
  local payload, field = record, record
  local modern = false
  local ok, reservation = pcall(cjson.decode, record)
  if ok and type(reservation) == 'table' and reservation.strataReservation == 1 then
    payload, field, modern = reservation.payload, reservation.id, true
  end
  local raw = redis.call('HGET', KEYS[3], field)
  local expired = true
  if raw then
    if modern then
      local leaseOk, lease = pcall(cjson.decode, raw)
      expired = not leaseOk or type(lease) ~= 'table' or not tonumber(lease.expiresAt) or tonumber(lease.expiresAt) <= now
    else
      local reservedAt = tonumber(raw)
      expired = not reservedAt or now - reservedAt >= tonumber(ARGV[1])
    end
  end
  if expired then
    redis.call('LPUSH', KEYS[1], payload)
    redis.call('LREM', KEYS[2], 1, record)
    redis.call('HDEL', KEYS[3], field)
    reclaimed = reclaimed + 1
  end
end
return reclaimed
`;

function queueInvalidKey(queueKey: string): string {
  return `${queueKey}:invalid`;
}

async function reserveQueueJob(
  client: RedisClient,
  queueKey: string,
  owner: string,
): Promise<QueueReservation | null> {
  const raw = await client.send("EVAL", [
    RESERVE_JOB,
    "3",
    queueKey,
    queueProcessingKey(queueKey),
    queueProcessingLeaseKey(queueKey),
    crypto.randomUUID(),
    owner,
    String(readVisibilityMs()),
  ]);
  if (typeof raw !== "string") return null;
  const reservation = JSON.parse(raw) as Omit<QueueReservation, "record">;
  return { ...reservation, record: raw };
}

async function updateQueueReservation(
  client: RedisClient,
  queueKey: string,
  reservation: QueueReservation,
  action: "renew" | "ack" | "quarantine",
): Promise<boolean> {
  return (
    Number(
      await client.send("EVAL", [
        RENEW_OR_ACK,
        "3",
        queueProcessingKey(queueKey),
        queueProcessingLeaseKey(queueKey),
        queueInvalidKey(queueKey),
        reservation.id,
        reservation.owner,
        reservation.record,
        action,
        String(readVisibilityMs()),
        reservation.payload,
      ]),
    ) === 1
  );
}

async function reclaimExpiredQueueReservations(
  client: RedisClient,
  queueKeys: readonly string[] = QUEUE_KEYS,
): Promise<number> {
  let reclaimed = 0;
  for (const key of queueKeys) {
    reclaimed += Number(
      await client.send("EVAL", [
        RECLAIM_JOBS,
        "3",
        key,
        queueProcessingKey(key),
        queueProcessingLeaseKey(key),
        String(readVisibilityMs()),
      ]),
    );
  }
  return reclaimed;
}

class RedisQueue implements Queue {
  private readonly client: RedisClient;

  constructor(redisUrl: string) {
    this.client = new RedisClient(redisUrl);
  }

  close(): void {
    this.client.close();
  }

  async dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void> {
    const name = jobRegistry.resolveName(job);

    if (!name) {
      throw new Error("Job is not registered with the queue worker registry.");
    }

    const envelope: QueueJobEnvelope = {
      name,
      payload: payload as Record<string, unknown>,
      attempts: 0,
    };

    const queueKey = queueKeyForPriority(job.priority);
    await this.client.lpush(queueKey, JSON.stringify(envelope));
  }
}

class QueueWorker {
  private readonly owner = crypto.randomUUID();
  private running = false;
  private stopping = false;
  private readonly client: RedisClient;

  constructor(
    redisUrl: string,
    private readonly failedJobs: FailedJobService,
    private readonly timeoutSeconds = 5,
    private readonly queueKeys: readonly string[] = QUEUE_KEYS,
  ) {
    this.client = new RedisClient(redisUrl);
  }

  requestStop(): void {
    this.stopping = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async reserve(): Promise<{ queueKey: string; reservation: QueueReservation } | null> {
    const deadline = performance.now() + this.timeoutSeconds * 1000;
    do {
      for (const key of this.queueKeys) {
        if (this.stopping) return null;
        const reservation = await reserveQueueJob(this.client, key, this.owner);
        if (reservation) return { queueKey: key, reservation };
      }
      if (this.stopping || performance.now() >= deadline) return null;
      await Bun.sleep(Math.min(100, Math.max(1, deadline - performance.now())));
    } while (!this.stopping);
    return null;
  }

  async processNext(): Promise<boolean> {
    if (this.stopping) return false;
    await reclaimExpiredQueueReservations(this.client, this.queueKeys);
    const reserved = await this.reserve();
    if (!reserved) return false;
    const { queueKey, reservation } = reserved;
    const envelope = parseQueueJobEnvelope(reservation.payload);
    if (!envelope) {
      await updateQueueReservation(this.client, queueKey, reservation, "quarantine");
      return true;
    }

    let acknowledge = false;
    let ownershipLost = false;
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(
      () => {
        if (renewal || ownershipLost) return;
        renewal = (async () => {
          try {
            if (!(await updateQueueReservation(this.client, queueKey, reservation, "renew"))) {
              ownershipLost = true;
            }
          } catch (error) {
            ownershipLost = true;
            console.error("[QueueWorker] Lease renewal failed:", error);
          }
        })().finally(() => {
          renewal = undefined;
        });
      },
      Math.max(1, Math.floor(readVisibilityMs() / 3)),
    );
    try {
      await runQueueJob(envelope, this.failedJobs, {
        onFailureRecorded: () => {
          acknowledge = true;
        },
      });
      acknowledge = true;
    } catch (error) {
      console.error("[QueueWorker] Job failed:", error);
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
    if (acknowledge && !ownershipLost) {
      await updateQueueReservation(this.client, queueKey, reservation, "ack");
    }
    return true;
  }

  async run(): Promise<void> {
    this.running = true;

    try {
      while (!this.stopping) {
        await this.processNext();
      }
    } finally {
      this.running = false;
    }
  }

  close(): void {
    this.client.close();
  }
}

async function countPendingQueueJobs(redisUrl: string): Promise<number> {
  const client = new RedisClient(redisUrl);

  try {
    let total = 0;

    for (const queueKey of resolveRedisQueueTransport() === "streams"
      ? defaultQueueKeys()
      : QUEUE_KEYS) {
      total +=
        resolveRedisQueueTransport() === "streams"
          ? await readStreamQueueDepth(client, queueKey)
          : await client.llen(queueKey);
    }

    return total;
  } finally {
    client.close();
  }
}

export type { StreamReservation } from "./redisStreams";
export {
  migrateLegacyQueueToStreams,
  RedisStreamsQueue,
  RedisStreamsWorker,
  STREAM_GROUP,
  streamDeadLetterKey,
  streamQueueKey,
  updateStreamReservation,
} from "./redisStreams";
export type { QueueJobEnvelope, QueueReservation };
export {
  countPendingQueueJobs,
  parseQueueJobEnvelope,
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  QueueWorker,
  queueInvalidKey,
  queueKeyForPriority,
  queueProcessingKey,
  queueProcessingLeaseKey,
  RedisQueue,
  reclaimExpiredQueueReservations,
  reservationExpired,
  reserveQueueJob,
  updateQueueReservation,
};
