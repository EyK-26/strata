import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Job, type JobContext } from "@getstrata/core/queue";
import { createAppQueue, createQueueWorker } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { readRedisQueueDepth } from "@getstrata/core/queue/queueMetrics";
import {
  migrateLegacyQueueToStreams,
  queueKeyForPriority,
  RedisStreamsQueue,
  RedisStreamsWorker,
  STREAM_GROUP,
  streamDeadLetterKey,
  streamQueueKey,
  updateStreamReservation,
} from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}
const failedJobs = { recordFailure: async () => {} };
async function fixture(
  run: (client: RedisClient, keys: [string, string, string]) => Promise<void>,
) {
  const previousPrefix = process.env.APP_KEY_PREFIX;
  const previousVisibility = process.env.QUEUE_VISIBILITY_MS;
  const previousTransport = process.env.QUEUE_REDIS_TRANSPORT;
  process.env.APP_KEY_PREFIX = `streams-test-${crypto.randomUUID()}`;
  process.env.QUEUE_VISIBILITY_MS = "200";
  const keys: [string, string, string] = [
    queueKeyForPriority("high"),
    queueKeyForPriority(),
    queueKeyForPriority("low"),
  ];
  const client = new RedisClient(redisUrl);
  try {
    await run(client, keys);
  } finally {
    for (const key of keys)
      await client.del(
        key,
        `${key}:processing`,
        `${key}:processing:leases`,
        streamQueueKey(key),
        streamDeadLetterKey(key),
        `${key}:started`,
      );
    client.close();
    restoreEnvVar("APP_KEY_PREFIX", previousPrefix);
    restoreEnvVar("QUEUE_VISIBILITY_MS", previousVisibility);
    restoreEnvVar("QUEUE_REDIS_TRANSPORT", previousTransport);
  }
}
function tracked(job: Job): string {
  const name = `test.streams.${crypto.randomUUID()}`;
  jobRegistry.register(name, () => job);
  jobRegistry.track(name, job);
  return name;
}
async function entries(client: RedisClient, key: string): Promise<Array<[string, string[]]>> {
  return (await client.send("XRANGE", [streamQueueKey(key), "-", "+"])) as Array<
    [string, string[]]
  >;
}
async function agePending(client: RedisClient, key: string) {
  const pending = (await client.send("XPENDING", [
    streamQueueKey(key),
    STREAM_GROUP,
    "-",
    "+",
    "1",
  ])) as Array<[string, string, number, number]>;
  const entry = pending[0];
  if (!entry) throw new Error("Expected a pending entry");
  await client.send("XCLAIM", [
    streamQueueKey(key),
    STREAM_GROUP,
    entry[1],
    "0",
    entry[0],
    "IDLE",
    "10000",
    "JUSTID",
  ]);
}

describe.skipIf(!redisUrl)("Redis Streams queue recovery", () => {
  test("dispatch and consumer groups preserve priority and delete only acknowledged entries", async () => {
    await fixture(async (client, keys) => {
      const seen: string[] = [];
      class Echo extends Job<{ marker: string }> {
        constructor(override readonly priority: "high" | "default" | "low") {
          super();
        }
        async handle(payload: { marker: string }, context?: JobContext) {
          expect(context?.jobId).toContain(":stream/");
          expect(context?.signal.aborted).toBe(false);
          seen.push(payload.marker);
        }
      }
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      try {
        for (const priority of ["low", "default", "high"] as const) {
          const job = new Echo(priority);
          tracked(job);
          await queue.dispatch(job, { marker: priority });
        }
        process.env.QUEUE_REDIS_TRANSPORT = "streams";
        expect((await readRedisQueueDepth(redisUrl)).total).toBe(3);
        for (let i = 0; i < 3; i++) expect(await worker.processNext()).toBe(true);
        expect(seen).toEqual(["high", "default", "low"]);
        expect((await readRedisQueueDepth(redisUrl)).total).toBe(0);
        for (const key of keys) {
          expect(await entries(client, key)).toEqual([]);
          expect(
            await client.send("XINFO", ["CONSUMERS", streamQueueKey(key), STREAM_GROUP]),
          ).toEqual([]);
        }
        expect(await worker.processNext()).toBe(false);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });

  test("opt-in factories use Streams and unknown transport values fail closed", async () => {
    await fixture(async () => {
      process.env.QUEUE_REDIS_TRANSPORT = "streams";
      const queue = createAppQueue("redis", redisUrl, failedJobs as never);
      const worker = createQueueWorker(redisUrl, failedJobs as never);
      try {
        expect(queue).toBeInstanceOf(RedisStreamsQueue);
        expect(worker).toBeInstanceOf(RedisStreamsWorker);
      } finally {
        queue.close?.();
        worker.close();
      }
      process.env.QUEUE_REDIS_TRANSPORT = "typo";
      expect(() => createAppQueue("redis", redisUrl, failedJobs as never)).toThrow(
        "QUEUE_REDIS_TRANSPORT",
      );
      expect(() => createQueueWorker(redisUrl, failedJobs as never)).toThrow(
        "QUEUE_REDIS_TRANSPORT",
      );
    });
  });

  test("maintenance conversion is bounded, FIFO, repeatable, and refuses processing reservations", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      for (const payload of ["first", "second", "third"]) await client.lpush(key, payload);
      await client.lpush(`${key}:processing`, "owned");
      await expect(
        migrateLegacyQueueToStreams(client, { maintenance: true, queueKeys: [key] }),
      ).rejects.toThrow("processing reservations");
      expect(await client.llen(key)).toBe(3);
      expect(await entries(client, key)).toEqual([]);
      await client.del(`${key}:processing`);
      await client.set(streamQueueKey(key), "wrongtype");
      await expect(
        migrateLegacyQueueToStreams(client, { maintenance: true, queueKeys: [key] }),
      ).rejects.toThrow("key type");
      expect(await client.llen(key)).toBe(3);
      await client.del(streamQueueKey(key));
      await expect(
        migrateLegacyQueueToStreams(client, { maintenance: false as true, queueKeys: [key] }),
      ).rejects.toThrow("maintenance mode");
      await expect(
        migrateLegacyQueueToStreams(client, {
          maintenance: true,
          batchSize: 1001,
          queueKeys: [key],
        }),
      ).rejects.toThrow("batchSize");
      expect(
        await migrateLegacyQueueToStreams(client, {
          maintenance: true,
          batchSize: 2,
          queueKeys: [key],
        }),
      ).toBe(2);
      expect(
        await migrateLegacyQueueToStreams(client, {
          maintenance: true,
          batchSize: 2,
          queueKeys: [key],
        }),
      ).toBe(1);
      expect(
        await migrateLegacyQueueToStreams(client, { maintenance: true, queueKeys: [key] }),
      ).toBe(0);
      expect((await entries(client, key)).map((entry) => entry[1][1])).toEqual([
        "first",
        "second",
        "third",
      ]);
    });
  });

  test("Streams producers and workers refuse activation while old queue data remains", async () => {
    await fixture(async (client, keys) => {
      class Echo extends Job {
        async handle() {}
      }
      const job = new Echo();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      try {
        await client.lpush(keys[1], "old-job");
        await expect(queue.dispatch(job, {})).rejects.toThrow("maintenance conversion");
        await expect(worker.processNext()).rejects.toThrow("maintenance conversion");
        expect(await client.llen(keys[1])).toBe(1);
      } finally {
        queue.close();
        worker.close();
      }
    });
  });

  test("expired and stale owners cannot renew or acknowledge another consumer's work", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      try {
        await worker.processNext();
        const id = String(await client.send("XADD", [streamQueueKey(key), "*", "payload", "raw"]));
        await client.send("XREADGROUP", [
          "GROUP",
          STREAM_GROUP,
          "old",
          "COUNT",
          "1",
          "STREAMS",
          streamQueueKey(key),
          ">",
        ]);
        const old = { id, owner: "old", payload: "raw" };
        expect(await updateStreamReservation(client, key, old, "renew")).toBe(true);
        await agePending(client, key);
        expect(await updateStreamReservation(client, key, old, "renew")).toBe(false);
        expect(await updateStreamReservation(client, key, old, "ack")).toBe(false);
        await client.send("XAUTOCLAIM", [
          streamQueueKey(key),
          STREAM_GROUP,
          "replacement",
          "200",
          "0-0",
          "COUNT",
          "1",
        ]);
        expect(await updateStreamReservation(client, key, old, "ack")).toBe(false);
        expect(
          await updateStreamReservation(client, key, { ...old, owner: "replacement" }, "ack"),
        ).toBe(true);
        expect(await entries(client, key)).toEqual([]);
      } finally {
        worker.close();
      }
    });
  });

  test("failed SQL recording retains the pending entry and recovery preserves transport identity", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const identities: string[] = [];
      class Failure extends Job {
        override readonly maxAttempts = 1;
        async handle(_payload: object, context?: JobContext) {
          identities.push(required(context).jobId);
          throw new Error("business failure");
        }
      }
      const job = new Failure();
      tracked(job);
      let records = 0;
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async () => {
            if (++records === 1) throw new Error("SQL unavailable");
          },
        } as never,
        0,
        [key],
      );
      try {
        await queue.dispatch(job, {});
        await worker.processNext();
        expect(await entries(client, key)).toHaveLength(1);
        await agePending(client, key);
        await worker.processNext();
        expect(await entries(client, key)).toEqual([]);
        expect(identities).toHaveLength(2);
        expect(identities[0]).toBe(identities[1]);
        expect(records).toBe(2);
        expect(
          await client.send("XINFO", ["CONSUMERS", streamQueueKey(key), STREAM_GROUP]),
        ).toEqual([]);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });

  test("malformed envelopes are quarantined atomically; invalid destination types retain recovery state", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      try {
        await client.send("XADD", [streamQueueKey(key), "*", "payload", "bad-json"]);
        await client.set(streamDeadLetterKey(key), "wrongtype");
        await expect(worker.processNext()).rejects.toThrow("quarantine key type");
        expect(await entries(client, key)).toHaveLength(1);
        await client.del(streamDeadLetterKey(key));
        await agePending(client, key);
        await worker.processNext();
        expect(await entries(client, key)).toEqual([]);
        const invalid = (await client.send("XRANGE", [
          streamDeadLetterKey(key),
          "-",
          "+",
        ])) as Array<[string, string[]]>;
        expect(invalid).toHaveLength(1);
        expect(required(invalid[0])[1]).toContain("bad-json");
      } finally {
        worker.close();
      }
    });
  });

  test("slow healthy jobs renew; graceful stopping drains the admitted job and excludes its successor", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      let enter!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let completed = 0;
      class Slow extends Job {
        async handle(_payload: object, context?: JobContext) {
          enter();
          await gate;
          expect(required(context).signal.aborted).toBe(false);
          completed++;
        }
      }
      const job = new Slow();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      const peer = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      try {
        await queue.dispatch(job, {});
        const running = worker.processNext();
        await started;
        await expect(worker.processNext()).rejects.toThrow("already processing");
        await Bun.sleep(650);
        expect(await peer.processNext()).toBe(false);
        await queue.dispatch(job, {});
        worker.requestStop();
        release();
        await running;
        expect(completed).toBe(1);
        expect(await entries(client, key)).toHaveLength(1);
        expect(await worker.processNext()).toBe(false);
      } finally {
        release();
        worker.close();
        peer.close();
        queue.close();
      }
    });
  });

  test("ownership loss aborts the handler signal and prevents stale acknowledgement or failure recording", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let signal: AbortSignal | undefined;
      class Cooperative extends Job {
        async handle(_payload: object, context?: JobContext) {
          signal = required(context).signal;
          entered();
          await new Promise<void>((resolve) =>
            required(signal).addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
        }
      }
      const job = new Cooperative();
      tracked(job);
      let recorded = 0;
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async () => {
            recorded++;
          },
        } as never,
        0,
        [key],
      );
      try {
        await queue.dispatch(job, {});
        const running = worker.processNext();
        await started;
        const id = required((await entries(client, key))[0])[0];
        await client.send("XCLAIM", [
          streamQueueKey(key),
          STREAM_GROUP,
          "new-owner",
          "0",
          id,
          "JUSTID",
        ]);
        await running;
        expect(required(signal).aborted).toBe(true);
        expect(recorded).toBe(0);
        expect(await entries(client, key)).toHaveLength(1);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });

  test("idle polling does not retain consumers after repeated worker restarts", async () => {
    await fixture(async (client, keys) => {
      for (let i = 0; i < 20; i++) {
        const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
        try {
          expect(await worker.processNext()).toBe(false);
        } finally {
          worker.close();
        }
      }
      for (const key of keys)
        expect(
          await client.send("XINFO", ["CONSUMERS", streamQueueKey(key), STREAM_GROUP]),
        ).toEqual([]);
    });
  });
  test("SIGKILL leaves a recoverable pending entry with the same job identity", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const name = `test.killed.stream.${crypto.randomUUID()}`;
      const source = join(import.meta.dir, "../../src/core/queue");
      const script = `
        import { RedisClient } from "bun";
        import { Job } from ${JSON.stringify(`${source}/index.ts`)};
        import { jobRegistry } from ${JSON.stringify(`${source}/jobRegistry.ts`)};
        import { RedisStreamsWorker } from ${JSON.stringify(`${source}/redisStreams.ts`)};
        const client = new RedisClient(process.env.REDIS_URL);
        class Blocked extends Job { async handle(payload, context) {
          await client.set(${JSON.stringify(`${key}:started`)}, context.jobId);
          await new Promise(() => {});
        } }
        jobRegistry.register(${JSON.stringify(name)}, () => new Blocked());
        await new RedisStreamsWorker(process.env.REDIS_URL, {}, 0, [${JSON.stringify(key)}]).processNext();
      `;
      await client.send("XADD", [
        streamQueueKey(key),
        "*",
        "payload",
        JSON.stringify({ name, payload: {} }),
      ]);
      const child = Bun.spawn(["bun", "-e", script], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env },
        stdout: "ignore",
        stderr: "pipe",
      });
      try {
        const deadline = performance.now() + 3000;
        while (!(await client.get(`${key}:started`))) {
          if (performance.now() > deadline || child.exitCode !== null) {
            child.kill("SIGKILL");
            await child.exited;
            throw new Error(`Child did not start: ${await new Response(child.stderr).text()}`);
          }
          await Bun.sleep(10);
        }
        const originalId = required((await client.get(`${key}:started`)) ?? undefined);
        child.kill("SIGKILL");
        await child.exited;
        await Bun.sleep(250);
        let delivered = 0;
        class Recovered extends Job {
          async handle(_payload: object, context?: JobContext) {
            expect(required(context).jobId).toBe(originalId);
            delivered++;
          }
        }
        jobRegistry.register(name, () => new Recovered());
        const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
        try {
          expect(await worker.processNext()).toBe(true);
        } finally {
          worker.close();
        }
        expect(delivered).toBe(1);
        expect(await entries(client, key)).toEqual([]);
        expect(
          await client.send("XINFO", ["CONSUMERS", streamQueueKey(key), STREAM_GROUP]),
        ).toEqual([]);
      } finally {
        child.kill();
        await child.exited;
      }
    });
  }, 6000);

  test("bounded reclaim cursors eventually reach an abandoned entry beyond healthy pending jobs", async () => {
    await fixture(async (client, keys) => {
      process.env.QUEUE_VISIBILITY_MS = "10000";
      const key = keys[1];
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      try {
        await worker.processNext();
        let executed = 0;
        class Echo extends Job {
          async handle() {
            executed++;
          }
        }
        const name = tracked(new Echo());
        let lastId = "";
        for (let i = 0; i < 65; i++)
          lastId = String(
            await client.send("XADD", [
              streamQueueKey(key),
              "*",
              "payload",
              JSON.stringify({ name, payload: {} }),
            ]),
          );
        await client.send("XREADGROUP", [
          "GROUP",
          STREAM_GROUP,
          "busy",
          "COUNT",
          "65",
          "STREAMS",
          streamQueueKey(key),
          ">",
        ]);
        await client.send("XCLAIM", [
          streamQueueKey(key),
          STREAM_GROUP,
          "dead",
          "0",
          lastId,
          "IDLE",
          "50000",
          "JUSTID",
        ]);
        let recovered = false;
        for (let i = 0; i < 10 && !recovered; i++) recovered = await worker.processNext();
        expect(recovered).toBe(true);
        expect(executed).toBe(1);
        expect(await entries(client, key)).toHaveLength(64);
        const consumers = (await client.send("XINFO", [
          "CONSUMERS",
          streamQueueKey(key),
          STREAM_GROUP,
        ])) as string[][];
        expect(consumers.flat()).not.toContain("dead");
      } finally {
        worker.close();
      }
    });
  });

  test("lost acknowledgement and migration replies leave their atomic transitions complete", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      await client.lpush(key, "retained");
      const lostReply = new Proxy(client, {
        get(target, property) {
          if (property === "send")
            return async (command: string, args: string[]) => {
              await target.send(command, args);
              throw new Error("disconnected after execution");
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(
        migrateLegacyQueueToStreams(lostReply, { maintenance: true, queueKeys: [key] }),
      ).rejects.toThrow("disconnected after execution");
      expect(await client.llen(key)).toBe(0);
      expect(await entries(client, key)).toHaveLength(1);
      expect(
        await migrateLegacyQueueToStreams(client, { maintenance: true, queueKeys: [key] }),
      ).toBe(0);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      // Initialize without handling the migrated malformed record.
      await client.send("XGROUP", ["CREATE", streamQueueKey(key), STREAM_GROUP, "0"]);
      await client.send("XREADGROUP", [
        "GROUP",
        STREAM_GROUP,
        "owner",
        "COUNT",
        "1",
        "STREAMS",
        streamQueueKey(key),
        ">",
      ]);
      const id = required((await entries(client, key))[0])[0];
      const reservation = { id, owner: "owner", payload: "retained" };
      try {
        await expect(updateStreamReservation(lostReply, key, reservation, "ack")).rejects.toThrow(
          "disconnected after execution",
        );
        expect(await entries(client, key)).toEqual([]);
        expect(await updateStreamReservation(client, key, reservation, "ack")).toBe(false);
      } finally {
        worker.close();
      }
    });
  });
  test("running workers stop idle polling and reset running state after startup errors", async () => {
    await fixture(async (client, keys) => {
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 1, keys);
      try {
        expect(worker.isRunning()).toBe(false);
        const running = worker.run();
        expect(worker.isRunning()).toBe(true);
        await Bun.sleep(30);
        worker.requestStop();
        await running;
        expect(worker.isRunning()).toBe(false);
      } finally {
        worker.close();
      }
      await client.set(streamQueueKey(keys[1]), "wrongtype");
      const invalid = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [keys[1]]);
      try {
        await expect(invalid.run()).rejects.toThrow("WRONGTYPE");
        expect(invalid.isRunning()).toBe(false);
      } finally {
        invalid.close();
      }
    });
  });

  test("forced close aborts active handlers while retaining pending work for recovery", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      class Cooperative extends Job {
        async handle(_payload: object, context?: JobContext) {
          const signal = required(context).signal;
          entered();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
        }
      }
      const job = new Cooperative();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, [key]);
      try {
        await queue.dispatch(job, {});
        const running = worker.processNext();
        await started;
        worker.close();
        await running;
        expect(await entries(client, key)).toHaveLength(1);
      } finally {
        queue.close();
        worker.close();
      }
    });
  });
  test("Redis renewal permission failure aborts ownership without acknowledging the pending entry", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const user = `stream-test-${crypto.randomUUID()}`;
      const password = crypto.randomUUID();
      await client.send("ACL", ["SETUSER", user, "on", `>${password}`, "~*", "+@all"]);
      const url = new URL(redisUrl);
      url.username = user;
      url.password = password;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let aborted = false;
      class Cooperative extends Job {
        async handle(_payload: object, context?: JobContext) {
          const signal = required(context).signal;
          entered();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          aborted = signal.aborted;
          signal.throwIfAborted();
        }
      }
      const job = new Cooperative();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      let recorded = 0;
      const worker = new RedisStreamsWorker(
        url.toString(),
        {
          recordFailure: async () => {
            recorded++;
          },
        } as never,
        0,
        [key],
      );
      try {
        await queue.dispatch(job, {});
        const running = worker.processNext();
        await started;
        await client.send("ACL", ["SETUSER", user, "-eval"]);
        await running;
        expect(aborted).toBe(true);
        expect(recorded).toBe(0);
        expect(await entries(client, key)).toHaveLength(1);
      } finally {
        worker.close();
        queue.close();
        await client.send("ACL", ["DELUSER", user]);
      }
    });
  });
});
