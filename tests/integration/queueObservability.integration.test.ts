import { describe, expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import {
  INFLIGHT_SAMPLE_LIMIT,
  readRedisQueueSnapshot,
  renderRedisQueueMetrics,
} from "@getstrata/core/queue/queueMetrics";
import { queueKeyForPriority } from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";
import {
  STREAM_GROUP,
  streamDeadLetterKey,
  streamQueueKey,
  streamRetryKey,
} from "../../src/core/queue/redisStreams";
import { restoreEnvVar } from "../helpers/restoreEnv";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
async function fixture(run: (client: RedisClient, key: string) => Promise<void>) {
  const previous = process.env.APP_KEY_PREFIX;
  process.env.APP_KEY_PREFIX = `observability-${crypto.randomUUID()}`;
  const client = new RedisClient(redisUrl);
  try {
    await run(client, queueKeyForPriority());
  } finally {
    for (const priority of ["high", "default", "low"] as const) {
      const key = queueKeyForPriority(priority);
      await client.del(
        key,
        `${key}:processing`,
        `${key}:invalid`,
        streamQueueKey(key),
        streamRetryKey(key),
        streamDeadLetterKey(key),
      );
    }
    client.close();
    restoreEnvVar("APP_KEY_PREFIX", previous);
  }
}

describe("bounded Redis queue observations", () => {
  test("empty and pre-consumer Streams are observable without creating a group", async () => {
    await fixture(async (client, key) => {
      const empty = await readRedisQueueSnapshot(redisUrl, { transport: "streams" });
      expect(empty.priorities.map((row) => row.unfinished)).toEqual([0, 0, 0]);
      await client.send("XADD", [streamQueueKey(key), "*", "payload", "secret-payload"]);
      const snapshot = await readRedisQueueSnapshot(redisUrl, { transport: "streams" });
      expect(snapshot.priorities[1]?.ready).toBe(1);
      expect(snapshot.priorities[1]?.inflight).toBe(0);
      const rendered = renderRedisQueueMetrics(snapshot);
      expect(rendered).not.toContain("secret-payload");
      expect(rendered).not.toContain(key);
      expect(rendered).toContain('priority="default",state="ready"} 1');
      expect(await client.send("XINFO", ["GROUPS", streamQueueKey(key)])).toEqual([]);
    });
  });

  test("separates ready, inflight, due/future retries and quarantine atomically", async () => {
    await fixture(async (client, key) => {
      const stream = streamQueueKey(key);
      await client.send("XADD", [stream, "1-0", "payload", "private-job"]);
      await client.send("XADD", [stream, "*", "payload", "another-job"]);
      await client.send("XGROUP", ["CREATE", stream, STREAM_GROUP, "0"]);
      await client.send("XREADGROUP", [
        "GROUP",
        STREAM_GROUP,
        "private-owner",
        "COUNT",
        "1",
        "STREAMS",
        stream,
        ">",
      ]);
      await client.send("ZADD", [
        streamRetryKey(key),
        "1",
        "private-due",
        "9007199254740991",
        "private-future",
      ]);
      await client.lpush(streamDeadLetterKey(key), "private-invalid");
      const row = (await readRedisQueueSnapshot(redisUrl, { transport: "streams" })).priorities[1];
      expect(row).toMatchObject({
        unfinished: 4,
        ready: 1,
        inflight: 1,
        inflightCapped: false,
        retryDue: 1,
        retryWaiting: 1,
        quarantined: 1,
      });
      expect(row?.retryActionableLatenessSeconds).toBeGreaterThan(1_000_000);
      expect(row?.oldestStreamEntryAgeSeconds).toBeGreaterThan(1_000_000);
      expect(await client.send("XLEN", [stream])).toBe(2);
      expect(await client.send("ZCARD", [streamRetryKey(key)])).toBe(2);
    });
  });

  test("retry lateness uses Redis time, excludes future waits and omits cancellation sentinel age", async () => {
    await fixture(async (client, key) => {
      const retries = streamRetryKey(key);
      const now = await client.send("TIME", []);
      if (!Array.isArray(now)) throw new Error("Invalid fixture time");
      const ms = Number(now[0]) * 1000 + Math.floor(Number(now[1]) / 1000);
      await client.send("ZADD", [retries, String(ms + 60_000), "private-future"]);
      const read = async () => readRedisQueueSnapshot(redisUrl, { transport: "streams" });
      expect((await read()).priorities[1]?.retryActionableLatenessSeconds).toBe(0);
      await client.send("ZADD", [retries, String(ms - 5000), "private-overdue"]);
      const before = await client.send("ZRANGE", [retries, "0", "-1", "WITHSCORES"]);
      const snapshot = await read();
      expect(snapshot.priorities[1]?.retryActionableLatenessSeconds).toBeGreaterThanOrEqual(5);
      expect(snapshot.priorities[1]?.retryActionableLatenessSeconds).toBeLessThan(10);
      expect(renderRedisQueueMetrics(snapshot)).toContain(
        'strata_queue_retry_actionable_lateness_seconds{priority="default"}',
      );
      expect(await client.send("ZRANGE", [retries, "0", "-1", "WITHSCORES"])).toEqual(before);
      await client.send("ZADD", [retries, "0", "private-cancelled"]);
      const cancelled = await read();
      expect(cancelled.priorities[1]?.retryActionableLatenessSeconds).toBeNull();
      expect(cancelled.priorities[1]?.retryDue).toBe(2);
      expect(renderRedisQueueMetrics(cancelled)).not.toContain(
        'strata_queue_retry_actionable_lateness_seconds{priority="default"}',
      );
      await client.send("ZREM", [retries, "private-cancelled", "private-overdue"]);
      expect((await read()).priorities[1]?.retryActionableLatenessSeconds).toBe(0);
      for (const invalid of ["-1", "1.5"]) {
        await client.send("ZADD", [retries, invalid, "private-invalid-score"]);
        await expect(read()).rejects.toThrow();
      }
    });
  });

  test("caps pending reads and omits unknown ready counts instead of reporting zero", async () => {
    await fixture(async (client, key) => {
      const stream = streamQueueKey(key);
      for (let i = 0; i <= INFLIGHT_SAMPLE_LIMIT; i++)
        await client.send("XADD", [stream, "*", "payload", "private"]);
      await client.send("XGROUP", ["CREATE", stream, STREAM_GROUP, "0"]);
      await client.send("XREADGROUP", [
        "GROUP",
        STREAM_GROUP,
        "owner",
        "COUNT",
        String(INFLIGHT_SAMPLE_LIMIT + 1),
        "STREAMS",
        stream,
        ">",
      ]);
      const snapshot = await readRedisQueueSnapshot(redisUrl, { transport: "streams" });
      expect(snapshot.priorities[1]).toMatchObject({
        unfinished: 501,
        ready: null,
        inflight: 500,
        inflightCapped: true,
      });
      const rendered = renderRedisQueueMetrics(snapshot);
      expect(rendered).not.toContain('priority="default",state="ready"');
      expect(rendered).toContain('strata_queue_inflight_sample_capped{priority="default"} 1');
      // Fixed output size even when the shared queue contains more than the sample cap.
      expect(rendered.length).toBeLessThan(4500);
    });
  });

  test("list state counts reservations and omits unavailable age/retry measurements", async () => {
    await fixture(async (client, key) => {
      await client.lpush(key, "private-ready");
      await client.lpush(`${key}:processing`, "private-processing");
      await client.lpush(`${key}:invalid`, "private-invalid");
      const snapshot = await readRedisQueueSnapshot(redisUrl, { transport: "lists" });
      expect(snapshot.priorities[1]).toMatchObject({
        unfinished: 2,
        ready: 1,
        inflight: 1,
        quarantined: 1,
        oldestStreamEntryAgeSeconds: null,
        retryActionableLatenessSeconds: null,
      });
      const rendered = renderRedisQueueMetrics(snapshot);
      expect(rendered).not.toContain('state="retry_due"');
      expect(rendered).not.toContain("strata_queue_oldest_stream_entry_age_seconds{");
    });
  });

  test("three independent processes read identical shared state, not additive per-process counts", async () => {
    await fixture(async (client, key) => {
      await client.lpush(key, "private");
      const source = new URL("../../src/core/queue/queueMetrics.ts", import.meta.url).pathname;
      const results = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const child = Bun.spawn(
            [
              process.execPath,
              "--no-env-file",
              "-e",
              `import {readRedisQueueSnapshot} from ${JSON.stringify(source)}; console.log(JSON.stringify(await readRedisQueueSnapshot(process.env.REDIS_URL,{transport:'lists'})));`,
            ],
            { env: { ...process.env, REDIS_URL: redisUrl }, stdout: "pipe", stderr: "pipe" },
          );
          const result = await new Response(child.stdout).text();
          expect(await child.exited).toBe(0);
          return JSON.parse(result);
        }),
      );
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
      expect(results[0].priorities[1].unfinished).toBe(1);
    });
  });

  test("authenticated scrapes recover after a collection failure without retaining stale values", async () => {
    await fixture(async (client, key) => {
      const oldToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = "fixture-token";
      const routes = createMetricsRoutes({ queue: { redisUrl, transport: "streams" } });
      const scrape = async () =>
        (
          await routes["/metrics"](
            new Request("http://localhost/metrics", {
              headers: { authorization: "Bearer fixture-token" },
            }),
          )
        ).text();
      try {
        await client.send("XADD", [streamQueueKey(key), "*", "payload", "private"]);
        const success = await scrape();
        expect(success).toContain("strata_queue_collector_success 1");
        expect(success).toContain('priority="default",state="ready"} 1');
        await client.del(streamQueueKey(key));
        await client.set(streamQueueKey(key), "wrong-type");
        const failed = await scrape();
        expect(failed).toContain("strata_queue_collector_success 0");
        expect(failed).not.toContain("strata_queue_jobs");
        await client.del(streamQueueKey(key));
        expect(await scrape()).toContain('priority="default",state="ready"} 0');
      } finally {
        restoreEnvVar("METRICS_TOKEN", oldToken);
      }
    });
  });

  test("wrong Redis types fail rather than inventing a healthy empty queue", async () => {
    await fixture(async (client, key) => {
      await client.set(streamQueueKey(key), "invalid");
      await expect(readRedisQueueSnapshot(redisUrl, { transport: "streams" })).rejects.toThrow();
      const oldToken = process.env.METRICS_TOKEN;
      process.env.METRICS_TOKEN = "fixture-token";
      try {
        const routes = createMetricsRoutes({ queue: { redisUrl, transport: "streams" } });
        const response = await routes["/metrics"](
          new Request("http://localhost/metrics", {
            headers: { authorization: "Bearer fixture-token" },
          }),
        );
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(body).toContain("http_requests_total");
        expect(body).toContain("strata_queue_collector_success 0");
        expect(body).not.toContain("strata_queue_jobs");
        expect(body).not.toContain(redisUrl);
      } finally {
        restoreEnvVar("METRICS_TOKEN", oldToken);
      }
    });
  });

  test("stalled Redis is bounded by the deadline and concurrent scrapes share one connection", async () => {
    let connections = 0;
    let closed = 0;
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
        },
        data() {},
        close() {
          closed++;
        },
      },
    });
    const oldToken = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = "fixture-token";
    try {
      const url = `redis://127.0.0.1:${server.port}`;
      const routes = createMetricsRoutes({ queue: { redisUrl: url, timeoutMs: 50 } });
      const start = performance.now();
      const bodies = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const response = await routes["/metrics"](
            new Request("http://localhost/metrics", {
              headers: { authorization: "Bearer fixture-token" },
            }),
          );
          return response.text();
        }),
      );
      expect(connections).toBe(1);
      await Bun.sleep(10);
      expect(closed).toBe(1);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(bodies.every((body) => body.includes("strata_queue_collector_success 0"))).toBe(true);
    } finally {
      restoreEnvVar("METRICS_TOKEN", oldToken);
      server.stop(true);
    }
  });

  test("rejects invalid options before I/O", async () => {
    for (const timeoutMs of [0, -1, 5001, NaN, 1.5])
      await expect(readRedisQueueSnapshot(redisUrl, { timeoutMs })).rejects.toThrow();
    await expect(readRedisQueueSnapshot(" ")).rejects.toThrow();
  });
});
