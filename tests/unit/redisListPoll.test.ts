import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import {
  pollListPriorities,
  queueProcessingKey,
  queueProcessingLeaseKey,
} from "../../src/core/queue/redisQueue";

function replies(values: unknown[]) {
  return {
    send: async () => {
      if (!values.length) throw new Error("Unexpected protocol call");
      return values.shift();
    },
  };
}

describe("list poll replies", () => {
  test("rejects a malformed Redis reply", async () => {
    for (const value of ["0", ["2"], ["1"], ["1", "1"], ["1", "0", "{}"], ["1", "2", 1]]) {
      await expect(
        pollListPriorities(replies([value]) as never, ["high"], "owner", "id", false),
      ).rejects.toThrow("Invalid Redis list poll response");
    }
    expect(
      await pollListPriorities(replies([["0"]]) as never, ["high"], "owner", "id", false),
    ).toBeNull();
  });
});

const redisUrl = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";

describe("list poll against Redis", () => {
  test("reserves the higher priority and reclaims an expired reservation", async () => {
    const client = new RedisClient(redisUrl);
    const suffix = crypto.randomUUID();
    const high = `strata:test:list-poll:${suffix}:high`;
    const middle = `strata:test:list-poll:${suffix}:default`;
    const low = `strata:test:list-poll:${suffix}:low`;
    const keys = [high, middle, low];
    const processing = queueProcessingKey(low);
    const leases = queueProcessingLeaseKey(low);
    const payload = JSON.stringify({ name: "Ping", payload: {}, attempts: 0 });
    const expired = JSON.stringify({
      strataReservation: 1,
      id: "old",
      owner: "dead",
      payload,
    });
    try {
      await client.send("LPUSH", [
        high,
        JSON.stringify({ name: "High", payload: {}, attempts: 0 }),
      ]);
      await client.send("LPUSH", [low, payload]);
      const first = await pollListPriorities(client, keys, "worker", crypto.randomUUID(), true);
      expect(first?.queueKey).toBe(high);
      const second = await pollListPriorities(client, keys, "worker", crypto.randomUUID(), false);
      expect(second?.queueKey).toBe(low);

      await client.send("DEL", [low, processing, leases]);
      await client.send("LPUSH", [processing, expired]);
      await client.send("HSET", [leases, "old", JSON.stringify({ owner: "dead", expiresAt: 1 })]);
      expect(
        await pollListPriorities(client, keys, "worker", crypto.randomUUID(), false),
      ).toBeNull();
      expect(await client.send("LLEN", [processing])).toBe(1);

      const reclaimed = await pollListPriorities(client, keys, "worker", crypto.randomUUID(), true);
      expect(reclaimed?.queueKey).toBe(low);
      expect(reclaimed?.reservation.payload).toBe(payload);
      expect(reclaimed?.reservation.owner).toBe("worker");
    } finally {
      const cleanup = keys.flatMap((key) => [
        key,
        queueProcessingKey(key),
        queueProcessingLeaseKey(key),
      ]);
      await client.send("DEL", cleanup);
      client.close();
    }
  });
});
