import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Application, CommandScope } from "@getstrata/core/contracts/application";
import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { RedisClient } from "bun";

const { STARTER_WEBHOOK_OPTIONS_TOKEN, STARTER_QUEUE_TOKEN } = await import(
  resolve("src/bootstrap/providers/index.ts")
);
const { bootstrapApp } = await import(resolve("src/bootstrap/createApp.ts"));
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
const hooksDefinition = defineRepository({
  name: "fixture.webhooks",
  table: defineTable<Hook, "id">({
    name: "webhooks",
    primaryKey: "id",
    columns: ["id", "url", "secret", "events", "active"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const deliveriesDefinition = defineRepository({
  name: "fixture.deliveries",
  table: defineTable<Delivery, "id">({
    name: "webhook_deliveries",
    primaryKey: "id",
    columns: ["id", "webhook_id", "event", "payload", "response_status", "attempt", "error"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const redisUrl = process.env.QUEUE_DRIVER === "redis" ? process.env.REDIS_URL : undefined;
if (process.env.QUEUE_DRIVER === "redis")
  assert.ok(redisUrl, "Redis consumer requires its configured URL");
let owner: Application | undefined;
let redis: RedisClient | undefined;
let receiver: ReturnType<typeof Bun.serve> | undefined;
let baselineEmpty = false;
const failures: unknown[] = [];
const pattern = `${process.env.APP_KEY_PREFIX}:*`;
try {
  const app = await bootstrapApp({
    onConstructed: (application: Application) => {
      owner = application;
    },
    migrate: false,
    mode: redisUrl ? "worker" : "command",
    persistence: { repositories: [hooksDefinition, deliveriesDefinition] },
  });
  const failed: import("@getstrata/core/queue/createAppQueue").QueueServices = app.queueServices;
  const run = <T>(work: (database: DatabaseSession) => T | Promise<T>): Promise<T> =>
    app.invoke(
      { kind: "command", actor: { kind: "system", policy: "fixture.webhook" } },
      ({ database }: ExecutionPersistence) => work(database),
    );
  redis = redisUrl ? new RedisClient(redisUrl) : undefined;
  if (redis) assert.deepEqual(await redis.send("KEYS", [pattern]), []);
  baselineEmpty = true;
  console.log(JSON.stringify({ ownedRedisPattern: redis ? pattern : null, baselineEmpty: true }));
  const worker = redisUrl ? app.worker : undefined;
  if (redisUrl) assert.ok(worker, "Redis fixture requires the app-owned worker transport");
  const queue = await app.application.run((scope: CommandScope) =>
    scope.resolve(STARTER_QUEUE_TOKEN),
  );
  const webhookOptions = (await app.application.run((scope: CommandScope) =>
    scope.resolve(STARTER_WEBHOOK_OPTIONS_TOKEN),
  )) as Readonly<{ allowPrivate: boolean; signatureHeader: string }>;
  const received: Array<{ path: string; event: string }> = [];
  const ownedReceiver = Bun.serve({
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
  receiver = ownedReceiver;
  async function drain() {
    if (worker)
      for (let i = 0; i < 30 && (await worker.processNext()); i++) {
        /* Bounded processing through the real worker. */
      }
  }
  async function dispatch(event: string, url: string, corruptId = false) {
    const hook = await run((database) =>
      database.repository(hooksDefinition).create({
        url,
        secret: "owned-fixture-secret",
        events: "*",
        active: false,
      }),
    );
    const payload = {
      webhookId: hook.id,
      event,
      url,
      secret: hook.secret,
      body: JSON.stringify({ event }),
      allowPrivate: webhookOptions.allowPrivate,
      signatureHeader: webhookOptions.signatureHeader,
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
  await dispatch("transient", `${ownedReceiver.url}transient`);
  const recovered = await run((database) =>
    database
      .repository(deliveriesDefinition)
      .query()
      .where({ event: "transient" })
      .orderBy({ id: "ASC" })
      .get(),
  );
  assert.deepEqual(
    recovered.map((row) => [row.attempt, row.response_status]),
    [
      [1, 503],
      [2, 200],
    ],
  );
  assert.equal((await failed.listRecent()).length, 0);
  const terminal = await dispatch("permanent", `${ownedReceiver.url}permanent`);
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
    (
      await run((database) =>
        database
          .repository(deliveriesDefinition)
          .query()
          .where({ event: "permanent" })
          .orderBy({ id: "ASC" })
          .get(),
      )
    ).map((row) => row.attempt),
    [1, 2, 3],
  );
  assert.equal((await failed.listRecent()).length, 1);
  const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unused") });
  const unavailable = closed.url.href;
  closed.stop(true);
  await dispatch("transport", unavailable);
  assert.equal((await failed.listRecent()).length, 2);
  const recordingFailure = await dispatch("recording", `${ownedReceiver.url}recording`, true);
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
    await run((database) =>
      database.repository(hooksDefinition).create({
        url: `${ownedReceiver.url}${name}`,
        secret: "owned-fixture-secret",
        events,
        active,
      }),
    );
  await run((database) => database.model(Note).create({ body: "committed note" }));
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
    run((database) =>
      database.transaction(async (transaction) => {
        await transaction.model(Note).create({ body: "rolled back note" });
        throw new Error("owned rollback");
      }),
    ),
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
} catch (error) {
  failures.push(error);
} finally {
  try {
    await receiver?.stop(true);
  } catch (error) {
    failures.push(error);
  }
  let applicationClosed = !owner;
  if (owner) {
    try {
      assert.ok((await owner.stop()).successful);
      applicationClosed = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (redis) {
    try {
      if (applicationClosed && baselineEmpty) {
        const keys = (await redis.send("KEYS", [pattern])) as string[];
        assert.ok(keys.every((key) => key.startsWith(`${process.env.APP_KEY_PREFIX}:`)));
        if (keys.length) await redis.del(...keys);
        assert.deepEqual(await redis.send("KEYS", [pattern]), []);
        console.log(JSON.stringify({ ownedRedisCleanup: keys, restoredEmptyBaseline: true }));
      } else if (!applicationClosed)
        failures.push(new Error("Application stop unconfirmed; Redis prefix retained"));
    } catch (error) {
      failures.push(error);
    }
    try {
      redis.close();
    } catch (error) {
      failures.push(error);
    }
  }
}
if (failures.length === 1) throw failures[0];
if (failures.length > 1) throw new AggregateError(failures, "Webhook consumer and cleanup failed");
