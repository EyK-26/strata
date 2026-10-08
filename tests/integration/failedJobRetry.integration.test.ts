import { describe, expect, test } from "bun:test";
import { Job } from "@getstrata/core/queue";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { queueKeyForPriority, RedisQueue } from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";

const redisUrl = process.env.REDIS_URL?.trim() ?? "";

describe.skipIf(!redisUrl)("failed-job SQL recovery and Redis admission", () => {
  test("a rejected Redis write preserves SQL recovery; successful priority admission precedes deletion", async () => {
    const previousPrefix = process.env.APP_KEY_PREFIX;
    process.env.APP_KEY_PREFIX = `retry-test-${crypto.randomUUID()}`;
    const client = new RedisClient(redisUrl);
    const queue = new RedisQueue(redisUrl);
    const service = createFailedJobService();
    const key = queueKeyForPriority("high");
    let id: number | undefined;
    let executions = 0;
    class Replay extends Job<{ marker: string }> {
      override readonly priority = "high";
      override async handle() {
        executions++;
      }
    }
    const name = `test.retry.${crypto.randomUUID()}`;
    const job = new Replay();
    jobRegistry.register(name, () => job);
    jobRegistry.track(name, job);
    try {
      const record = await service.recordFailure({
        jobName: name,
        payload: { marker: "persisted" },
        exception: "original failure",
      });
      id = record.id;
      // WRONGTYPE is a real Redis admission failure, without disrupting shared Redis.
      await client.set(key, "unavailable-list");
      await expect(
        service.retry(id, (failed) => queue.dispatch(job, failed.payload)),
      ).rejects.toThrow();
      expect((await service.listRecent()).some((entry) => entry.id === id)).toBe(true);
      await client.del(key);
      await service.retry(id, async (failed) => {
        await queue.dispatch(job, failed.payload);
        expect(await client.llen(key)).toBe(1);
        expect((await service.listRecent()).some((entry) => entry.id === id)).toBe(true);
      });
      expect((await service.listRecent()).some((entry) => entry.id === id)).toBe(false);
      expect(executions).toBe(0);
      expect(JSON.parse((await client.rpop(key)) ?? "null")).toEqual({
        name,
        payload: { marker: "persisted" },
        attempts: 0,
      });
    } finally {
      if (id !== undefined) await service.delete(id).catch(() => {});
      await client.del(key);
      queue.close();
      client.close();
      restoreEnvVar("APP_KEY_PREFIX", previousPrefix);
    }
  });
});
