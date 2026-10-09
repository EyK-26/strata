import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Job, type JobContext } from "@getstrata/core/queue";
import {
  createAppQueue,
  createFailedJobService,
  createQueueWorker,
} from "@getstrata/core/queue/createAppQueue";
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
import {
  cancelStreamJob,
  promoteStreamRetries,
  reserveStreamJob,
  scheduleStreamRetry,
  streamControlKey,
  streamRetryKey,
} from "../../src/core/queue/redisStreams";
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
        streamRetryKey(key),
        `${key}:started`,
      );
    for (const key of keys) {
      let cursor = "0";
      do {
        const response = (await client.send("SCAN", [
          cursor,
          "MATCH",
          `${streamQueueKey(key)}:control:*`,
          "COUNT",
          "100",
        ])) as [string, string[]];
        cursor = response[0];
        if (response[1].length) await client.del(...response[1]);
      } while (cursor !== "0");
    }
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
  test("SQL failed-job replay preserves identity, resets controls, and retains recovery on rejected admission", async () => {
    await fixture(async (client, keys) => {
      const service = createFailedJobService();
      const seen: string[] = [];
      let shouldFail = true;
      const job = new (class extends Job {
        override readonly maxAttempts = 1;
        async handle(_payload: object, context?: JobContext) {
          seen.push(required(context).jobId);
          expect(context?.deadlineAtMs).toBeUndefined();
          if (shouldFail) throw new Error("Expected terminal failure");
        }
      })();
      const name = tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, service, 0, keys);
      let recordId: number | undefined;
      try {
        const id = await queue.enqueue(job, {}, { cancellable: true });
        await worker.processNext();
        const failed = (await service.listRecent(1000)).find((record) => record.job_name === name);
        if (!failed) throw new Error("Expected recovery record");
        recordId = failed.id;
        expect(failed.job_id).toBe(id);
        expect(await queue.cancel(id)).toBe(false);
        await client.set(streamQueueKey(keys[1]), "wrong type");
        await expect(
          service.retry(failed.id, (record) =>
            queue.replay(job, record.payload, record.job_id ?? ""),
          ),
        ).rejects.toThrow();
        expect((await service.listRecent(1000)).some((record) => record.id === failed.id)).toBe(
          true,
        );
        await client.del(streamQueueKey(keys[1]));
        // Recreate the group after deliberate corruption repair in this isolated fixture.
        const nextWorker = new RedisStreamsWorker(redisUrl, service, 0, keys);
        try {
          // The admission completed, but the operator did not receive its acknowledgement.
          await expect(
            service.retry(failed.id, async (record) => {
              await queue.replay(job, record.payload, record.job_id ?? "");
              throw new Error("Lost replay acknowledgement");
            }),
          ).rejects.toThrow("Lost replay acknowledgement");
          expect((await service.listRecent(1000)).some((record) => record.id === failed.id)).toBe(
            true,
          );
          await service.retry(failed.id, async (record) => {
            await queue.replay(job, record.payload, record.job_id ?? "");
            const envelope = JSON.parse(
              required((await entries(client, keys[1]))[0])[1][1] ?? "{}",
            );
            expect(envelope).toEqual({ name, payload: {}, attempts: 0, jobId: id });
            expect((await entries(client, keys[1])).length).toBe(2);
          });
          shouldFail = false;
          await nextWorker.processNext();
          await nextWorker.processNext();
          expect(seen).toEqual([id, id, id]);
          expect((await service.listRecent(1000)).some((record) => record.id === failed.id)).toBe(
            false,
          );
        } finally {
          nextWorker.close();
        }
        await expect(queue.replay(job, {}, "foreign")).rejects.toThrow("namespace");
        await expect(queue.replay(job, {}, `${streamQueueKey(keys[1])}/bad`)).rejects.toThrow(
          "namespace",
        );
      } finally {
        if (recordId !== undefined) await service.delete(recordId).catch(() => {});
        worker.close();
        queue.close();
      }
    });
  });
  test("cancelled and deadline failures retain logical identity in SQL", async () => {
    await fixture(async (_client, keys) => {
      const service = createFailedJobService();
      const job = new (class extends Job {
        async handle() {
          throw new Error("Must not execute");
        }
      })();
      const name = tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, service, 0, keys);
      const ids: number[] = [];
      try {
        const cancelled = await queue.enqueue(job, {}, { cancellable: true });
        await queue.cancel(cancelled);
        await worker.processNext();
        const expired = await queue.enqueue(job, {}, { timeoutMs: 10 });
        await Bun.sleep(30);
        await worker.processNext();
        const failures = (await service.listRecent(1000)).filter(
          (record) => record.job_name === name,
        );
        ids.push(...failures.map((record) => record.id));
        expect(failures.map((record) => record.job_id).sort()).toEqual([cancelled, expired].sort());
        expect(failures.map((record) => record.exception).sort()).toEqual(
          ["Streams job cancelled", "Streams job deadline exceeded"].sort(),
        );
      } finally {
        for (const id of ids) await service.delete(id);
        worker.close();
        queue.close();
      }
    });
  });
  test("cancellation survives queue close and SQL failure until a recovered worker acknowledges", async () => {
    await fixture(async (client, keys) => {
      let calls = 0;
      let failures = 0;
      const job = new (class extends Job {
        async handle() {
          calls++;
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const failed = {
        recordFailure: async (failure: { exception: string }) => {
          expect(failure.exception).toBe("Streams job cancelled");
          if (++failures === 1) throw new Error("SQL unavailable");
        },
      };
      const first = new RedisStreamsWorker(redisUrl, failed as never, 0, keys);
      try {
        const id = await queue.enqueue(job, {}, { cancellable: true });
        expect(await queue.cancel(id)).toBe(true);
        expect(await queue.cancel(id)).toBe(true);
        queue.close();
        await expect(first.processNext()).rejects.toThrow("SQL unavailable");
        first.close();
        expect(await client.send("HGET", [streamControlKey(keys[1], id), "state"])).toBe(
          "cancelled",
        );
        await agePending(client, keys[1]);
        const next = new RedisStreamsWorker(redisUrl, failed as never, 0, keys);
        try {
          expect(await next.processNext()).toBe(true);
        } finally {
          next.close();
        }
        expect(calls).toBe(0);
        expect(failures).toBe(2);
        expect(await client.send("EXISTS", [streamControlKey(keys[1], id)])).toBe(0);
        const fresh = new RedisStreamsQueue(redisUrl);
        try {
          expect(await fresh.cancel(id)).toBe(false);
        } finally {
          fresh.close();
        }
      } finally {
        first.close();
        queue.close();
      }
    });
  });
  test("cancelled retries wake promptly without resetting the job identity or calling its handler again", async () => {
    await fixture(async (client, keys) => {
      let calls = 0;
      let failures = 0;
      const job = new (class extends Job {
        override readonly backoffMs = 3600000;
        async handle() {
          calls++;
          throw new Error("Retry later");
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async () => {
            failures++;
          },
        } as never,
        0,
        keys,
      );
      try {
        const id = await queue.enqueue(job, {}, { cancellable: true });
        expect(await worker.processNext()).toBe(true);
        const members = (await client.send("ZRANGE", [
          streamRetryKey(keys[1]),
          "0",
          "-1",
        ])) as string[];
        expect(JSON.parse(required(members[0])).jobId).toBe(id);
        expect(await queue.cancel(id)).toBe(true);
        expect(
          Number(await client.send("ZSCORE", [streamRetryKey(keys[1]), required(members[0])])),
        ).toBe(0);
        expect(await worker.processNext()).toBe(true);
        expect(calls).toBe(1);
        expect(failures).toBe(1);
        expect(
          await client.send("EXISTS", [streamControlKey(keys[1], id), streamRetryKey(keys[1])]),
        ).toBe(0);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("running cancellation aborts cooperative I/O and retains ownership while ignored", async () => {
    await fixture(async (client, keys) => {
      for (const cooperative of [true, false]) {
        let started: () => void = () => {};
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        let returned = false;
        let failures = 0;
        const job = new (class extends Job {
          async handle(_payload: object, context?: JobContext) {
            const signal = required(context).signal;
            started();
            if (cooperative)
              await new Promise<void>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              );
            else {
              await Bun.sleep(350);
              expect(signal.aborted).toBe(true);
            }
            returned = true;
          }
        })();
        tracked(job);
        const queue = new RedisStreamsQueue(redisUrl);
        const worker = new RedisStreamsWorker(
          redisUrl,
          {
            recordFailure: async (failure: { exception: string }) => {
              expect(failure.exception).toBe("Streams job cancelled");
              failures++;
            },
          } as never,
          0,
          keys,
        );
        const competitor = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
        try {
          const id = await queue.enqueue(job, {}, { cancellable: true });
          const running = worker.processNext();
          await entered;
          expect(await queue.cancel(id)).toBe(true);
          if (!cooperative) {
            await Bun.sleep(230);
            expect(returned).toBe(false);
            expect(await competitor.processNext()).toBe(false);
            expect(await client.send("EXISTS", [streamControlKey(keys[1], id)])).toBe(1);
          }
          expect(await running).toBe(true);
          expect(failures).toBe(1);
          expect(await client.send("EXISTS", [streamControlKey(keys[1], id)])).toBe(0);
        } finally {
          worker.close();
          competitor.close();
          queue.close();
        }
      }
    });
  });
  test("cancellation fences retry scheduling and stale owners cannot erase the control record", async () => {
    await fixture(async (client, keys) => {
      const queue = new RedisStreamsQueue(redisUrl);
      const job = new (class extends Job {
        async handle() {}
      })();
      const name = tracked(job);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      try {
        await worker.processNext();
        const id = await queue.enqueue(job, {}, { cancellable: true });
        const original = required(
          (await reserveStreamJob(client, keys[1], "original")).reservation ?? undefined,
        );
        expect(await queue.cancel(id)).toBe(true);
        await expect(
          scheduleStreamRetry(
            client,
            keys[1],
            original,
            { name, payload: {}, jobId: id, cancellable: true },
            0,
          ),
        ).rejects.toThrow("cancelled");
        expect(await client.send("ZCARD", [streamRetryKey(keys[1])])).toBe(0);
        await agePending(client, keys[1]);
        await reserveStreamJob(client, keys[1], "replacement");
        expect(
          await updateStreamReservation(
            client,
            keys[1],
            original,
            "ack",
            streamControlKey(keys[1], id),
          ),
        ).toBe(false);
        expect(await client.send("HGET", [streamControlKey(keys[1], id), "state"])).toBe(
          "cancelled",
        );
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("control corruption fails closed and cannot acknowledge business work", async () => {
    await fixture(async (client, keys) => {
      let calls = 0;
      const job = new (class extends Job {
        async handle() {
          calls++;
        }
      })();
      const name = tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      try {
        await worker.processNext();
        const id = await queue.enqueue(job, {}, { cancellable: true });
        await client.set(streamRetryKey(keys[1]), "wrong type");
        await expect(queue.cancel(id)).rejects.toThrow("retry key type");
        expect(await client.send("HGET", [streamControlKey(keys[1], id), "state"])).toBe("active");
        await client.del(streamRetryKey(keys[1]));
        const reservation = required(
          (await reserveStreamJob(client, keys[1], "owner")).reservation ?? undefined,
        );
        await client.del(streamControlKey(keys[1], id));
        await expect(
          scheduleStreamRetry(
            client,
            keys[1],
            reservation,
            { name, payload: {}, jobId: id, cancellable: true },
            0,
          ),
        ).rejects.toThrow("control state");
        await agePending(client, keys[1]);
        await expect(worker.processNext()).rejects.toThrow("control state");
        await client.set(streamControlKey(keys[1], id), "wrong type");
        await expect(
          updateStreamReservation(
            client,
            keys[1],
            { ...reservation, owner: "wrong" },
            "ack",
            streamControlKey(keys[1], id),
          ),
        ).resolves.toBe(false);
        expect(calls).toBe(0);
        expect((await entries(client, keys[1])).length).toBe(1);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("a lost cancellation reply remains durable and retrying cannot re-admit a promoted job", async () => {
    await fixture(async (client, keys) => {
      let calls = 0;
      const job = new (class extends Job {
        override readonly backoffMs = 3600000;
        async handle() {
          calls++;
          throw new Error("retry");
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      try {
        const id = await queue.enqueue(job, {}, { cancellable: true });
        await worker.processNext();
        const lostReply = {
          send: async (command: string, args: string[]) => {
            await client.send(command, args);
            throw new Error("Lost cancellation reply");
          },
        };
        await expect(cancelStreamJob(lostReply as never, keys[1], id)).rejects.toThrow(
          "Lost cancellation reply",
        );
        expect(await promoteStreamRetries(client, keys[1])).toBe(1);
        expect(await queue.cancel(id)).toBe(true);
        expect(await promoteStreamRetries(client, keys[1])).toBe(0);
        expect((await entries(client, keys[1])).length).toBe(1);
        await worker.processNext();
        expect(calls).toBe(1);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("cancellation during a failing handler blocks its deferred retry", async () => {
    await fixture(async (client, keys) => {
      const queue = new RedisStreamsQueue(redisUrl);
      let failures = 0;
      const job = new (class extends Job {
        async handle(_payload: object, context?: JobContext) {
          expect(await queue.cancel(required(context).jobId)).toBe(true);
          throw new Error("Failed after requesting cancellation");
        }
      })();
      const name = tracked(job);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async (failure: { exception: string }) => {
            expect(failure.exception).toBe("Streams job cancelled");
            failures++;
          },
        } as never,
        0,
        keys,
      );
      try {
        const id = await queue.enqueue(job, {}, { cancellable: true });
        await worker.processNext();
        expect(failures).toBe(1);
        expect(
          await client.send("EXISTS", [streamControlKey(keys[1], id), streamRetryKey(keys[1])]),
        ).toBe(0);
        await client.send("XADD", [
          streamQueueKey(keys[1]),
          "*",
          "payload",
          JSON.stringify({ name, payload: {}, jobId: "foreign", cancellable: true }),
        ]);
        expect(await worker.processNext()).toBe(true);
        expect(await client.send("XLEN", [streamDeadLetterKey(keys[1])])).toBe(1);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("only opted-in identities in this queue namespace can be cancelled", async () => {
    await fixture(async (_client, keys) => {
      const job = new (class extends Job {
        async handle() {}
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      try {
        const id = await queue.enqueue(job, {});
        expect(await queue.cancel(id)).toBe(false);
        for (const value of [
          "bad",
          `${streamQueueKey(keys[1])}/bad`,
          `other:stream/${crypto.randomUUID()}`,
        ])
          await expect(queue.cancel(value)).rejects.toThrow("job ID");
        await expect(queue.enqueue(job, {}, { cancellable: "true" as never })).rejects.toThrow(
          "boolean",
        );
      } finally {
        queue.close();
      }
    });
  });
  test("expired queued jobs never invoke handlers and retain recovery state if SQL recording fails", async () => {
    await fixture(async (client, keys) => {
      let calls = 0;
      let records = 0;
      const job = new (class extends Job {
        async handle() {
          calls++;
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async (failure: { exception: string }) => {
            expect(failure.exception).toBe("Streams job deadline exceeded");
            if (++records === 1) throw new Error("SQL unavailable");
          },
        } as never,
        0,
        keys,
      );
      try {
        const id = await queue.enqueue(job, {}, { timeoutMs: 20 });
        const envelope = JSON.parse(required((await entries(client, keys[1]))[0])[1][1] ?? "{}");
        expect(envelope.jobId).toBe(id);
        expect(envelope.deadlineAtMs).toBeGreaterThan(0);
        await Bun.sleep(40);
        await expect(worker.processNext()).rejects.toThrow("SQL unavailable");
        expect((await entries(client, keys[1])).length).toBe(1);
        await agePending(client, keys[1]);
        expect(await worker.processNext()).toBe(true);
        expect(calls).toBe(0);
        expect(records).toBe(2);
        expect(await entries(client, keys[1])).toEqual([]);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("live deadlines abort cooperative handlers without retrying them", async () => {
    await fixture(async (client, keys) => {
      let aborted = false;
      let failures = 0;
      const job = new (class extends Job {
        override readonly maxAttempts = 10;
        async handle(_payload: object, context?: JobContext) {
          const signal = required(context).signal;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async () => {
            failures++;
          },
        } as never,
        0,
        keys,
      );
      try {
        await worker.processNext();
        await queue.enqueue(job, {}, { timeoutMs: 200 });
        expect(await worker.processNext()).toBe(true);
        expect(aborted).toBe(true);
        expect(failures).toBe(1);
        expect(await entries(client, keys[1])).toEqual([]);
        expect(await client.send("ZCARD", [streamRetryKey(keys[1])])).toBe(0);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("deadline persists across retry admission and restart and caps the retry due time", async () => {
    await fixture(async (client, keys) => {
      let calls = 0;
      let failures = 0;
      const job = new (class extends Job {
        override readonly backoffMs = 10000;
        async handle() {
          calls++;
          throw new Error("Retry");
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const failed = {
        recordFailure: async () => {
          failures++;
        },
      };
      const first = new RedisStreamsWorker(redisUrl, failed as never, 0, keys);
      try {
        await first.processNext();
        await queue.enqueue(job, {}, { timeoutMs: 300 });
        const original = JSON.parse(required((await entries(client, keys[1]))[0])[1][1] ?? "{}");
        expect(await first.processNext()).toBe(true);
        first.close();
        const scheduled = (await client.send("ZRANGE", [
          streamRetryKey(keys[1]),
          "0",
          "-1",
        ])) as string[];
        expect(JSON.parse(required(scheduled[0])).deadlineAtMs).toBe(original.deadlineAtMs);
        expect(
          Number(await client.send("ZSCORE", [streamRetryKey(keys[1]), required(scheduled[0])])),
        ).toBe(original.deadlineAtMs);
        await Bun.sleep(320);
        const second = new RedisStreamsWorker(redisUrl, failed as never, 0, keys);
        try {
          expect(await second.processNext()).toBe(true);
        } finally {
          second.close();
        }
        expect(calls).toBe(1);
        expect(failures).toBe(1);
        expect(await entries(client, keys[1])).toEqual([]);
      } finally {
        first.close();
        queue.close();
      }
    });
  });
  test("deadline does not release ownership while a handler ignores its aborted signal", async () => {
    await fixture(async (client, keys) => {
      let returned = false;
      let failures = 0;
      const job = new (class extends Job {
        async handle(_payload: object, context?: JobContext) {
          await Bun.sleep(250);
          expect(required(context).signal.aborted).toBe(true);
          returned = true;
        }
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(
        redisUrl,
        {
          recordFailure: async () => {
            expect(returned).toBe(true);
            failures++;
          },
        } as never,
        0,
        keys,
      );
      try {
        await worker.processNext();
        await queue.enqueue(job, {}, { timeoutMs: 100 });
        const running = worker.processNext();
        await Bun.sleep(150);
        expect(returned).toBe(false);
        expect((await entries(client, keys[1])).length).toBe(1);
        expect(await running).toBe(true);
        expect(failures).toBe(1);
        expect(await entries(client, keys[1])).toEqual([]);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("invalid admission timeouts cannot enqueue work", async () => {
    await fixture(async (client, keys) => {
      const job = new (class extends Job {
        async handle() {}
      })();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      try {
        for (const timeoutMs of [0, -1, 0.1, NaN, Infinity, 2147483648])
          await expect(queue.enqueue(job, {}, { timeoutMs })).rejects.toThrow("timeoutMs");
        expect(await entries(client, keys[1])).toEqual([]);
      } finally {
        queue.close();
      }
    });
  });
  test("persisted backoff frees workers and resumes attempts and identity after restart", async () => {
    await fixture(async (client, keys) => {
      process.env.QUEUE_REDIS_TRANSPORT = "streams";
      const identities: string[] = [];
      let failures = 0;
      class Retry extends Job {
        override readonly maxAttempts = 3;
        override readonly backoffMs = 100;
        async handle(_payload: object, context?: JobContext) {
          identities.push(required(context).jobId);
          throw new Error("Expected retry");
        }
      }
      const job = new Retry();
      tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const failed = {
        recordFailure: async () => {
          failures++;
        },
      };
      try {
        await queue.dispatch(job, {});
        for (let attempt = 0; attempt < 3; attempt++) {
          const worker = new RedisStreamsWorker(redisUrl, failed as never, 0, keys);
          try {
            expect(await worker.processNext()).toBe(true);
            expect(identities.length).toBe(attempt + 1);
            expect((await readRedisQueueDepth(redisUrl)).total).toBe(attempt < 2 ? 1 : 0);
            expect(await worker.processNext()).toBe(false);
            expect(await entries(client, keys[1])).toEqual([]);
            if (attempt < 2) {
              const scheduled = (await client.send("ZRANGE", [
                streamRetryKey(keys[1]),
                "0",
                "-1",
              ])) as string[];
              expect(JSON.parse(required(scheduled[0])).attempts).toBe(attempt + 1);
            }
          } finally {
            worker.close();
          }
          if (attempt < 2) await Bun.sleep(120 * (attempt + 1));
        }
        expect(failures).toBe(1);
        expect(new Set(identities).size).toBe(1);
        expect(await client.send("EXISTS", [streamRetryKey(keys[1])])).toBe(0);
      } finally {
        queue.close();
      }
    });
  });
  test("retry scheduling fences expired owners and validates destinations before acknowledgement", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const job = new (class extends Job {
        async handle() {}
      })();
      const name = tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      try {
        await worker.processNext();
        await queue.dispatch(job, {});
        const reservation = required(
          (await reserveStreamJob(client, key, "owner")).reservation ?? undefined,
        );
        const next = { name, payload: {}, attempts: 1, jobId: "stable" };
        await client.set(streamRetryKey(key), "wrong type");
        await expect(scheduleStreamRetry(client, key, reservation, next, 0)).rejects.toThrow(
          "retry key type",
        );
        expect((await entries(client, key)).length).toBe(1);
        await client.del(streamRetryKey(key));
        await agePending(client, key);
        await expect(scheduleStreamRetry(client, key, reservation, next, 0)).rejects.toThrow(
          "lease lost",
        );
        const recovered = required(
          (await reserveStreamJob(client, key, "replacement")).reservation ?? undefined,
        );
        await expect(scheduleStreamRetry(client, key, reservation, next, 0)).rejects.toThrow(
          "lease lost",
        );
        await scheduleStreamRetry(client, key, recovered, next, 0);
        expect(await entries(client, key)).toEqual([]);
        expect(await promoteStreamRetries(client, key)).toBe(1);
        expect(JSON.parse(required((await entries(client, key))[0])[1][1] ?? "{}")).toEqual(next);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("lost schedule and promotion replies retain exactly one admitted retry", async () => {
    await fixture(async (client, keys) => {
      const key = keys[1];
      const job = new (class extends Job {
        async handle() {}
      })();
      const name = tracked(job);
      const queue = new RedisStreamsQueue(redisUrl);
      const worker = new RedisStreamsWorker(redisUrl, failedJobs as never, 0, keys);
      const loseReply = {
        send: async (command: string, args: string[]) => {
          await client.send(command, args);
          throw new Error("Lost reply after server execution");
        },
      };
      try {
        await worker.processNext();
        await queue.dispatch(job, {});
        const reservation = required(
          (await reserveStreamJob(client, key, "owner")).reservation ?? undefined,
        );
        const next = { name, payload: {}, attempts: 1, jobId: "stable" };
        await expect(
          scheduleStreamRetry(loseReply as never, key, reservation, next, 0),
        ).rejects.toThrow("Lost reply");
        expect(await entries(client, key)).toEqual([]);
        await expect(scheduleStreamRetry(client, key, reservation, next, 0)).rejects.toThrow(
          "lease lost",
        );
        await expect(promoteStreamRetries(loseReply as never, key)).rejects.toThrow("Lost reply");
        expect(await promoteStreamRetries(client, key)).toBe(0);
        expect((await entries(client, key)).length).toBe(1);
      } finally {
        worker.close();
        queue.close();
      }
    });
  });
  test("concurrent bounded promotion preserves every distinct envelope and priority", async () => {
    await fixture(async (client, keys) => {
      const key = keys[0];
      for (let i = 0; i < 205; i++)
        await client.send("ZADD", [streamRetryKey(key), "0", JSON.stringify({ jobId: String(i) })]);
      expect(await promoteStreamRetries(client, key)).toBe(100);
      expect(await client.send("ZCARD", [streamRetryKey(key)])).toBe(105);
      const other = new RedisClient(redisUrl);
      try {
        expect(
          (
            await Promise.all([promoteStreamRetries(client, key), promoteStreamRetries(other, key)])
          ).sort((a, b) => a - b),
        ).toEqual([5, 100]);
        expect((await entries(client, key)).length).toBe(205);
        expect(await entries(client, keys[1])).toEqual([]);
        expect(await client.send("EXISTS", [streamRetryKey(key)])).toBe(0);
      } finally {
        other.close();
      }
      await client.send("ZADD", [streamRetryKey(keys[2]), "0", "payload"]);
      await client.set(streamQueueKey(keys[2]), "wrong type");
      await expect(promoteStreamRetries(client, keys[2])).rejects.toThrow("promotion key type");
      expect(await client.send("ZCARD", [streamRetryKey(keys[2])])).toBe(1);
    });
  });
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
import { promoteStreamRetries, reserveStreamJob, scheduleStreamRetry, streamRetryKey } from "../../src/core/queue/redisStreams";
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
