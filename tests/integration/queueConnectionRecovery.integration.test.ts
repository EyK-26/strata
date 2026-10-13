import { expect, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { QueueWorker, RedisStreamsWorker, streamQueueKey } from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";
function connection(worker: object): RedisClient {
  const client = Object.getOwnPropertyDescriptor(worker, "client")?.value;
  if (!(client instanceof RedisClient)) throw new Error("Missing native worker connection");
  return client;
}
for (const transport of ["lists", "streams"] as const) {
  for (const boundary of ["poll", "ack"] as const) {
    test(`${transport} run recovers native connection closure at ${boundary} without losing admitted work`, async () => {
      const key = `queue-recovery-${crypto.randomUUID()}`;
      const oracle = new RedisClient(url);
      const previousVisibility = process.env.QUEUE_VISIBILITY_MS;
      process.env.QUEUE_VISIBILITY_MS = "200";
      const worker =
        transport === "streams"
          ? new RedisStreamsWorker(url, createFailedJobService(), 0, [key])
          : new QueueWorker(url, createFailedJobService(), 0, [key]);
      let effects = 0;
      class Effect extends Job {
        override async handle() {
          effects++;
          if (boundary === "ack" && effects === 1) connection(worker).close();
          else worker.requestStop();
        }
      }
      const job = new Effect();
      const name = `test.recovery.${crypto.randomUUID()}`;
      jobRegistry.register(name, () => job);
      jobRegistry.track(name, job);
      // Producer uses priority keys; explicitly copy only this fixture envelope
      // into the worker's isolated key, independent of shared queue namespaces.
      const encoded = JSON.stringify({ name, payload: {}, attempts: 0 });
      try {
        if (transport === "streams")
          await oracle.send("XADD", [streamQueueKey(key), "*", "payload", encoded]);
        else await oracle.lpush(key, encoded);
        const original = connection(worker);
        if (boundary === "poll") {
          await original.connect();
          original.close();
        }
        const watchdog = setTimeout(() => worker.close(), 5000);
        try {
          await worker.run();
        } finally {
          clearTimeout(watchdog);
        }
        expect(effects).toBe(boundary === "ack" ? 2 : 1);
        expect(connection(worker)).not.toBe(original);
        expect(worker.isRunning()).toBe(false);
        expect(
          transport === "streams"
            ? await oracle.send("XLEN", [streamQueueKey(key)])
            : await oracle.llen(`${key}:processing`),
        ).toBe(0);
      } finally {
        worker.close();
        await oracle.del(
          key,
          `${key}:processing`,
          `${key}:processing:leases`,
          `${key}:invalid`,
          streamQueueKey(key),
          `${streamQueueKey(key)}:invalid`,
        );
        oracle.close();
        if (previousVisibility === undefined) delete process.env.QUEUE_VISIBILITY_MS;
        else process.env.QUEUE_VISIBILITY_MS = previousVisibility;
      }
    }, 10000);
  }
  test(`${transport} explicit close during reconnection backoff stays terminal`, async () => {
    const worker =
      transport === "streams"
        ? new RedisStreamsWorker(url, createFailedJobService())
        : new QueueWorker(url, createFailedJobService());
    const original = connection(worker);
    await original.connect();
    original.close();
    const running = worker.run();
    await Bun.sleep(50);
    worker.close();
    await running;
    expect(connection(worker)).toBe(original);
    expect(worker.isRunning()).toBe(false);
  });
  for (const error of [
    null,
    "plain failure",
    new Error("protocol failure"),
    Object.assign(new Error("NOPERM"), { code: "ERR_REDIS_AUTHENTICATION_FAILED" }),
  ]) {
    test(`${transport} non-connection failures remain fatal: ${String(error)}`, async () => {
      const worker =
        transport === "streams"
          ? new RedisStreamsWorker(url, createFailedJobService())
          : new QueueWorker(url, createFailedJobService());
      worker.processNext = async () => {
        throw error;
      };
      try {
        await expect(worker.run()).rejects.toBe(error);
        expect(worker.isRunning()).toBe(false);
      } finally {
        worker.close();
      }
    });
  }
}
