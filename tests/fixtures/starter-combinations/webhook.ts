import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { RedisStreamsWorker } from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";

const { bootstrapApp } = await import(resolve("src/bootstrap/createApp.ts"));
const { closeDatabase } = await import(resolve("src/bootstrap/database.ts"));
const { Note } = await import(resolve("src/models/Note.ts"));
const { default: Dispatch } = await import(resolve("src/jobs/dispatchOutboundWebhookJob.ts"));
type Hook = { id: number; url: string; secret: string; events: string; active: boolean | number };
type Delivery = {
  id: number;
  webhook_id: number;
  event: string;
  payload: string;
  response_status: number | null;
  attempt: number;
  error: string | null;
};
const hooks = new BaseRepository(
  defineTable<Hook, "id">({
    name: "webhooks",
    primaryKey: "id",
    columns: ["id", "url", "secret", "events", "active"],
  }),
);
const deliveries = new BaseRepository(
  defineTable<Delivery, "id">({
    name: "webhook_deliveries",
    primaryKey: "id",
    columns: ["id", "webhook_id", "event", "payload", "response_status", "attempt", "error"],
  }),
);
const app = await bootstrapApp({ migrate: false });
const failed = createFailedJobService();
const redisUrl = process.env.QUEUE_DRIVER === "redis" ? process.env.REDIS_URL : undefined;
if (process.env.QUEUE_DRIVER === "redis")
  assert.ok(redisUrl, "Redis consumer requires its configured URL");
const redis = redisUrl ? new RedisClient(redisUrl) : undefined;
const pattern = `${process.env.APP_KEY_PREFIX}:*`;
if (redis) assert.deepEqual(await redis.send("KEYS", [pattern]), []);
console.log(JSON.stringify({ ownedRedisPattern: redis ? pattern : null, baselineEmpty: true }));
const worker = redisUrl ? new RedisStreamsWorker(redisUrl, failed, 0.05) : undefined;
const queue = app.context.container.resolve(CORE_QUEUE_TOKEN);
const received: Array<{ path: string; event: string }> = [];
const receiver = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as { event: string };
    received.push({ path, event: body.event });
    const count = received.filter((row) => row.path === path).length;
    return new Response("owned response body", {
      status:
        path === "/permanent" || path === "/recording" || (path === "/transient" && count === 1)
          ? 503
          : 200,
    });
  },
});
async function drain() {
  if (worker)
    for (let i = 0; i < 30 && (await worker.processNext()); i++) {
      /* Bounded processing through the real worker. */
    }
}
async function dispatch(event: string, url: string, corruptId = false) {
  const hook = await hooks.create({
    url,
    secret: "owned-fixture-secret",
    events: "*",
    active: false,
  });
  const payload = {
    webhookId: hook.id,
    event,
    url,
    secret: hook.secret,
    body: JSON.stringify({ event }),
  };
  if (corruptId) Reflect.set(payload, "webhookId", null); // Native NOT NULL sink fault; no wider database grants.
  let terminal: unknown;
  try {
    await queue.dispatch(new Dispatch(), payload);
  } catch (error) {
    terminal = error;
  }
  await drain();
  return terminal;
}
try {
  await dispatch("transient", `${receiver.url}transient`);
  const recovered = await deliveries
    .query()
    .where({ event: "transient" })
    .orderBy({ id: "ASC" })
    .get();
  assert.deepEqual(
    recovered.map((row) => [row.attempt, row.response_status]),
    [
      [1, 503],
      [2, 200],
    ],
  );
  assert.equal((await failed.listRecent()).length, 0);
  const terminal = await dispatch("permanent", `${receiver.url}permanent`);
  if (terminal instanceof Error)
    console.log(
      JSON.stringify({
        terminal: terminal.message,
        cause: String(terminal.cause ?? ""),
        stack: terminal.stack,
      }),
    );
  if (!worker) assert.ok(terminal, "Synchronous exhaustion must reject");
  assert.deepEqual(
    (await deliveries.query().where({ event: "permanent" }).orderBy({ id: "ASC" }).get()).map(
      (row) => row.attempt,
    ),
    [1, 2, 3],
  );
  assert.equal((await failed.listRecent()).length, 1);
  const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unused") });
  const unavailable = closed.url.href;
  closed.stop(true);
  await dispatch("transport", unavailable);
  assert.equal((await failed.listRecent()).length, 2);
  const recordingFailure = await dispatch("recording", `${receiver.url}recording`, true);
  if (!worker) assert.ok(recordingFailure instanceof AggregateError);
  assert.equal((await failed.listRecent()).length, 3);
  const terminalRows = await failed.listRecent();
  assert.ok(
    terminalRows.every((row) => row.failed_at instanceof Date && typeof row.payload === "object"),
  );
  assert.ok(
    terminalRows.find((row) => row.payload.event === "permanent")?.exception.includes("HTTP 503"),
  );
  assert.ok(
    terminalRows.find((row) => row.payload.event === "recording")?.exception.includes("HTTP 503"),
    "Recording faults must retain the original delivery failure",
  );
  for (const [name, events, active] of [
    ["wildcard", "*", true],
    ["matching", "notes.created", true],
    ["different", "orders.paid", true],
    ["inactive", "*", false],
  ] as const)
    await hooks.create({
      url: `${receiver.url}${name}`,
      secret: "owned-fixture-secret",
      events,
      active,
    });
  await Note.create({ body: "committed note" });
  await drain();
  assert.deepEqual(
    received
      .filter((row) => row.event === "notes.created")
      .map((row) => row.path)
      .sort(),
    ["/matching", "/wildcard"],
  );
  const before = received.length;
  await assert.rejects(
    runInTransaction(async () => {
      await Note.create({ body: "rolled back note" });
      throw new Error("owned rollback");
    }),
  );
  await drain();
  assert.equal(received.length, before);
  console.log(
    JSON.stringify({
      consumer: "webhook-delivery-selection-and-recovery",
      queue: process.env.QUEUE_DRIVER,
      transientAttempts: 2,
      terminalAttempts: 3,
      recoveredFailures: 3,
      rollback: "no delivery",
    }),
  );
} finally {
  worker?.close();
  receiver.stop(true);
  await app.context.dispose();
  await closeDatabase();
  if (redis) {
    const keys = (await redis.send("KEYS", [pattern])) as string[];
    assert.ok(keys.every((key) => key.startsWith(`${process.env.APP_KEY_PREFIX}:`)));
    if (keys.length) await redis.del(...keys);
    assert.deepEqual(await redis.send("KEYS", [pattern]), []);
    console.log(JSON.stringify({ ownedRedisCleanup: keys, restoredEmptyBaseline: true }));
    redis.close();
  }
}
