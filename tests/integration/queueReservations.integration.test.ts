import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Job } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import {
  QueueWorker,
  queueInvalidKey,
  queueProcessingKey,
  queueProcessingLeaseKey,
  reclaimExpiredQueueReservations,
  reserveQueueJob,
  updateQueueReservation,
} from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";
const describeRedis = redisUrl ? describe : describe.skip;

async function fixture(run: (client: RedisClient, key: string) => Promise<void>) {
  const client = new RedisClient(redisUrl);
  const key = `strata:test:reservation:${crypto.randomUUID()}`;
  try {
    await run(client, key);
  } finally {
    await client.del(
      key,
      queueProcessingKey(key),
      queueProcessingLeaseKey(key),
      queueInvalidKey(key),
    );
    client.close();
  }
}

describeRedis("queue reservation failure boundaries", () => {
  test("two equal payloads have independent identities, leases and acknowledgements", async () => {
    await fixture(async (client, key) => {
      const payload = JSON.stringify({ name: "job", payload: { id: 1 } });
      await client.lpush(key, payload, payload);
      const first = await reserveQueueJob(client, key, "first");
      const second = await reserveQueueJob(client, key, "second");
      if (!first || !second) throw new Error("Missing reservations");
      expect(first.id).not.toBe(second.id);
      expect(await client.hlen(queueProcessingLeaseKey(key))).toBe(2);
      expect(await updateQueueReservation(client, key, first, "ack")).toBe(true);
      expect(await client.llen(queueProcessingKey(key))).toBe(1);
      expect(await client.hget(queueProcessingLeaseKey(key), second.id)).toBeTruthy();
      expect(await reclaimExpiredQueueReservations(client, [key])).toBe(0);
      expect(await updateQueueReservation(client, key, second, "ack")).toBe(true);
    });
  });

  test("reserve writes the lease atomically and wrong destination types retain pending work", async () => {
    await fixture(async (client, key) => {
      await client.lpush(key, "payload");
      await client.set(queueProcessingLeaseKey(key), "wrong-type");
      await expect(reserveQueueJob(client, key, "worker")).rejects.toThrow();
      expect(await client.llen(key)).toBe(1);
      expect(await client.llen(queueProcessingKey(key))).toBe(0);
      await client.del(queueProcessingLeaseKey(key));
      const reservation = await reserveQueueJob(client, key, "worker");
      if (!reservation) throw new Error("Missing reservation");
      expect(await client.llen(key)).toBe(0);
      expect(await client.hget(queueProcessingLeaseKey(key), reservation.id)).toBeTruthy();
      expect(await reclaimExpiredQueueReservations(client, [key])).toBe(0);
    });
  });

  test("a rejected recovery destination and a lost Redis reply cannot erase a job", async () => {
    await fixture(async (client, key) => {
      await client.lpush(key, "payload");
      const reservation = await reserveQueueJob(client, key, "worker");
      if (!reservation) throw new Error("Missing reservation");
      await client.hset(
        queueProcessingLeaseKey(key),
        reservation.id,
        JSON.stringify({ owner: reservation.owner, expiresAt: 0 }),
      );
      await client.set(key, "wrong-type");
      await expect(reclaimExpiredQueueReservations(client, [key])).rejects.toThrow();
      expect(await client.llen(queueProcessingKey(key))).toBe(1);
      await client.del(key);
      const lostReply = new Proxy(client, {
        get(target, property) {
          if (property === "send")
            return async (command: string, args: string[]) => {
              await target.send(command, args);
              throw new Error("client disconnected after script execution");
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(reclaimExpiredQueueReservations(lostReply, [key])).rejects.toThrow(
        "client disconnected",
      );
      expect(await client.llen(queueProcessingKey(key))).toBe(0);
      expect(await client.llen(key)).toBe(1);
      expect(await reclaimExpiredQueueReservations(client, [key])).toBe(0);
    });
  });

  test("expired and stale owners cannot renew or acknowledge a replacement reservation", async () => {
    await fixture(async (client, key) => {
      await client.lpush(key, "payload");
      const old = await reserveQueueJob(client, key, "old");
      if (!old) throw new Error("Missing reservation");
      expect(await updateQueueReservation(client, key, { ...old, owner: "intruder" }, "ack")).toBe(
        false,
      );
      await client.hset(
        queueProcessingLeaseKey(key),
        old.id,
        JSON.stringify({ owner: old.owner, expiresAt: 0 }),
      );
      expect(await updateQueueReservation(client, key, old, "renew")).toBe(false);
      expect(await updateQueueReservation(client, key, old, "ack")).toBe(false);
      expect(await reclaimExpiredQueueReservations(client, [key])).toBe(1);
      const replacement = await reserveQueueJob(client, key, "new");
      if (!replacement) throw new Error("Missing replacement");
      expect(await updateQueueReservation(client, key, old, "ack")).toBe(false);
      expect(await client.llen(queueProcessingKey(key))).toBe(1);
      expect(await updateQueueReservation(client, key, replacement, "ack")).toBe(true);
    });
  });

  test("a failed failure-record write retains the job; a successful record permits acknowledgement", async () => {
    await fixture(async (client, key) => {
      class Failure extends Job {
        override readonly maxAttempts = 1;
        override async handle() {
          throw new Error("business failed");
        }
      }
      const name = `test.failure.${crypto.randomUUID()}`;
      jobRegistry.register(name, () => new Failure());
      await client.lpush(key, JSON.stringify({ name, payload: {}, attempts: 0 }));
      let saved = false;
      const service = {
        recordFailure: async () => {
          if (!saved) throw new Error("failed-job database unavailable");
        },
      };
      const worker = new QueueWorker(redisUrl, service as never, 0, [key]);
      try {
        await worker.processNext();
        expect(await client.llen(queueProcessingKey(key))).toBe(1);
        const records = await client.lrange(queueProcessingKey(key), 0, -1);
        const reservation = JSON.parse(records[0] ?? "{}");
        await client.hset(
          queueProcessingLeaseKey(key),
          reservation.id,
          JSON.stringify({ owner: reservation.owner, expiresAt: 0 }),
        );
        expect(await reclaimExpiredQueueReservations(client, [key])).toBe(1);
        saved = true;
        await worker.processNext();
        expect(await client.llen(key)).toBe(0);
        expect(await client.llen(queueProcessingKey(key))).toBe(0);
        expect(await client.hlen(queueProcessingLeaseKey(key))).toBe(0);
      } finally {
        worker.close();
      }
    });
  });

  test("a healthy slow handler renews its ownership across several visibility intervals", async () => {
    const previous = process.env.QUEUE_VISIBILITY_MS;
    process.env.QUEUE_VISIBILITY_MS = "200";
    try {
      await fixture(async (client, key) => {
        let start: () => void = () => {};
        let finish: () => void = () => {};
        const started = new Promise<void>((resolve) => {
          start = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          finish = resolve;
        });
        class Slow extends Job {
          override async handle() {
            start();
            await gate;
          }
        }
        const name = `test.slow.${crypto.randomUUID()}`;
        jobRegistry.register(name, () => new Slow());
        await client.lpush(key, JSON.stringify({ name, payload: {} }));
        const worker = new QueueWorker(redisUrl, { recordFailure: async () => {} } as never, 0, [
          key,
        ]);
        const running = worker.processNext();
        try {
          await started;
          await Bun.sleep(750);
          expect(await reclaimExpiredQueueReservations(client, [key])).toBe(0);
          expect(await client.llen(key)).toBe(0);
          expect(await client.llen(queueProcessingKey(key))).toBe(1);
        } finally {
          finish();
          await running;
          worker.close();
        }
        expect(await client.llen(queueProcessingKey(key))).toBe(0);
      });
    } finally {
      restoreEnvVar("QUEUE_VISIBILITY_MS", previous);
    }
  });

  test("SIGKILL of a real worker leaves a recoverable reservation", async () => {
    await fixture(async (client, key) => {
      const source = join(import.meta.dir, "../../src/core/queue");
      const name = `test.killed.${crypto.randomUUID()}`;
      const script = `
        import { QueueWorker } from ${JSON.stringify(`${source}/redisQueue.ts`)};
        import { Job } from ${JSON.stringify(`${source}/index.ts`)};
        import { jobRegistry } from ${JSON.stringify(`${source}/jobRegistry.ts`)};
        class Blocked extends Job { async handle() { await new Promise(() => {}); } }
        jobRegistry.register(${JSON.stringify(name)}, () => new Blocked());
        const worker = new QueueWorker(process.env.REDIS_URL, {}, 0, [${JSON.stringify(key)}]);
        await worker.processNext();
      `;
      await client.lpush(key, JSON.stringify({ name, payload: {} }));
      const child = Bun.spawn(["bun", "-e", script], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, QUEUE_VISIBILITY_MS: "200" },
        stdout: "ignore",
        stderr: "pipe",
      });
      try {
        const deadline = performance.now() + 3000;
        while ((await client.llen(queueProcessingKey(key))) === 0) {
          if (performance.now() >= deadline)
            throw new Error("Child worker did not reserve its job");
          await Bun.sleep(10);
        }
        child.kill("SIGKILL");
        await child.exited;
        await Bun.sleep(300);
        expect(await reclaimExpiredQueueReservations(client, [key])).toBe(1);
        let delivered = 0;
        class Recovered extends Job {
          override async handle() {
            delivered += 1;
          }
        }
        jobRegistry.register(name, () => new Recovered());
        const worker = new QueueWorker(redisUrl, {} as never, 0, [key]);
        try {
          await worker.processNext();
        } finally {
          worker.close();
        }
        expect(delivered).toBe(1);
        expect(await client.llen(key)).toBe(0);
        expect(await client.llen(queueProcessingKey(key))).toBe(0);
      } finally {
        child.kill();
        await child.exited;
      }
    });
  }, 6000);

  test("legacy processing lists recover atomically and invalid jobs remain inspectable", async () => {
    await fixture(async (client, key) => {
      const legacy = JSON.stringify({ name: "missing.job", payload: {} });
      await client.lpush(queueProcessingKey(key), legacy);
      await client.hset(queueProcessingLeaseKey(key), legacy, String(Date.now() - 120_000));
      expect(await reclaimExpiredQueueReservations(client, [key])).toBe(1);
      expect(await client.hlen(queueProcessingLeaseKey(key))).toBe(0);
      const worker = new QueueWorker(redisUrl, {} as never, 0, [key]);
      try {
        await worker.processNext();
      } finally {
        worker.close();
      }
      expect(await client.llen(queueProcessingKey(key))).toBe(0);
      expect(await client.lrange(queueInvalidKey(key), 0, -1)).toEqual([legacy]);
    });
  });
});
