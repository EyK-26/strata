import { Database } from "bun:sqlite";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineRepository,
  repositoryEffects,
  type TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import {
  createOutboxMigration,
  createOutboxWorkerTransport,
  createSqlOutboxBindings,
  type SqlOutbox,
} from "@getstrata/core/events/outbox";
import { createApplication } from "@getstrata/core/runtime/application";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";

type Row = { id: number; title: string };

test("BP outbox automatic transactional publication is acyclic and idle worker stop drains normally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-qa-outbox-"));
  const filename = join(directory, "outbox.sqlite");
  const shutdownEntered = deferred();
  const shutdownRelease = deferred();
  const shutdownAborted = deferred();
  const listenerToken =
    createServiceToken<TransactionalRepositoryListener<Row, "id">>("qa.outbox.publication");
  const notes = defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>({
    name: "OutboxNotes",
    table: defineTable<Row, "id">({
      name: "outbox_notes",
      primaryKey: "id",
      columns: ["id", "title"],
    }),
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  let app!: ReturnType<typeof createApplication>;
  const invoked = deferred();
  let deliveries = 0;
  const listenerEntered = deferred();
  const listenerRelease = deferred();
  const listenerAborted = deferred();
  const bindings = createSqlOutboxBindings({
    connection: "main",
    tenancy: "none",
    invoke: (input, work) => createPersistenceInvocation(app, "main")(input, work),
    listeners: [
      {
        name: "audit",
        event: "notes.created",
        async handle(event, { database, signal }) {
          if (event.id === "qa-event-2") {
            signal.addEventListener("abort", () => listenerAborted.resolve(), { once: true });
            listenerEntered.resolve();
            await listenerRelease.promise;
            signal.throwIfAborted();
          }
          if (event.id === "qa-event-3") {
            signal.addEventListener("abort", () => shutdownAborted.resolve(), { once: true });
            shutdownEntered.resolve();
            await shutdownRelease.promise;
            signal.throwIfAborted();
          }
          assert.equal("requestRollback" in database, false);
          await database.transaction(async (tx) => {
            await tx.execute({ text: "INSERT INTO audit VALUES (?)", params: [event.id] });
          });
          deliveries++;
        },
      },
    ],
  });
  const worker = createOutboxWorkerTransport(bindings.token, { pollMs: 1000 });
  const blockedWorker = createOutboxWorkerTransport(bindings.token, {
    pollMs: 1000,
    name: "qa.blocked.outbox",
  });
  app = createApplication({
    providers: [],
    services: [
      ...bindings.services,
      service(listenerToken, {
        lifetime: "application",
        dependencies: [bindings.token] as const,
        create: (outbox) => async (publication) => {
          await outbox.publish(publication.session, "notes.created", publication.row, {
            tenantId: null,
            id: publication.row.id === 1 ? "qa-event" : `qa-event-${publication.row.id}`,
          });
        },
      }),
      ...createDatabaseBindings({
        default: "main",
        repositories: [notes],
        repositoryEffects: [
          repositoryEffects(notes, [{ action: "created", transactional: listenerToken }]),
        ],
        preparation: [bindings.token],
        connections: { main: { driver: "sqlite", filename } },
      }),
    ],
    transports: [worker.transport, blockedWorker.transport],
  });
  await app.start();
  const invoke = createPersistenceInvocation(app, "main");
  let outbox!: SqlOutbox;
  try {
    await app.run((scope) => {
      outbox = scope.resolve(bindings.token);
    });
    await invoke({ kind: "command" }, async ({ database }) => {
      await createOutboxMigration("qa_outbox", "sqlite").up({
        unsafe: async <T>(query: string, params: readonly unknown[] = []) =>
          Array.from(await database.execute<T>({ text: query, params })),
      });
      await database.execute({
        text: "CREATE TABLE outbox_notes (id INTEGER PRIMARY KEY,title TEXT)",
        params: [],
      });
      await database.execute({ text: "CREATE TABLE audit (event_id TEXT)", params: [] });
      await database.transaction((tx) => tx.repository(notes).create({ id: 1, title: "owned" }));
      assert.equal((await outbox.getDelivery(database, "qa-event", "audit"))?.status, "pending");
    });
    assert.equal(await outbox.processNext(), true);
    assert.equal(deliveries, 1);
    await invoke({ kind: "command" }, async ({ database }) => {
      assert.equal((await outbox.getDelivery(database, "qa-event", "audit"))?.status, "completed");
      assert.deepEqual(await database.execute({ text: "SELECT event_id FROM audit", params: [] }), [
        { event_id: "qa-event" },
      ]);
    });
    const running = worker.start();
    // A real subsequent owned invocation observes that the worker has started, without fake invoke.
    await invoke({ kind: "command" }, async () => {
      invoked.resolve();
    });
    await bounded(invoked.promise);
    await bounded(worker.stop());
    await bounded(running);
    await bounded(worker.completion);
    await invoke({ kind: "command" }, async ({ database }) => {
      await database.transaction((tx) => tx.repository(notes).create({ id: 2, title: "blocked" }));
    });
    const blockedRunning = blockedWorker.start();
    await bounded(listenerEntered.promise);
    const stopping = blockedWorker.stop();
    await bounded(listenerAborted.promise);
    await pending(stopping);
    listenerRelease.resolve();
    await bounded(stopping);
    await bounded(blockedRunning);
    await bounded(blockedWorker.completion);
    assert.equal(deliveries, 1, "Cancelled handler must not complete its durable effect");
    await invoke({ kind: "command" }, async ({ database }) => {
      assert.notEqual(
        (await outbox.getDelivery(database, "qa-event-2", "audit"))?.status,
        "completed",
      );
    });
    await invoke({ kind: "command" }, async ({ database }) => {
      await database.transaction((tx) => tx.repository(notes).create({ id: 3, title: "shutdown" }));
    });
    const processing = outbox.processNext();
    const observed = processing.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    await bounded(shutdownEntered.promise);
    const closing = app.stop();
    await bounded(shutdownAborted.promise);
    await pending(closing);
    await assert.rejects(invoke({ kind: "command" }, async () => {}));
    shutdownRelease.resolve();
    await bounded(observed);
    const closed = await bounded(closing);
    assert.equal(closed.successful, true);
    assert.deepEqual(closed.snapshot.retainedResources, []);
    const inspection = new Database(filename, { readonly: true });
    try {
      const row = inspection
        .query("SELECT status FROM strata_outbox_delivery WHERE event_id = ?")
        .get("qa-event-3") as { status: string };
      assert.equal(
        row.status,
        "processing",
        "Closed admission leaves the durable lease recoverable instead of falsely completing",
      );
      assert.equal(
        (inspection.query("SELECT COUNT(*) AS total FROM audit").get() as { total: number }).total,
        1,
      );
    } finally {
      inspection.close();
    }
  } finally {
    listenerRelease.resolve();
    shutdownRelease.resolve();
    await app.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

test("outbox transport preserves an independent listener failure concurrent with its own stop", async () => {
  const failure = new Error("listener failed during host stop");
  let app!: ReturnType<typeof createApplication>;
  let stopping!: Promise<void>;
  const bindings = createSqlOutboxBindings({
    connection: "main",
    tenancy: "none",
    invoke: (input, work) => createPersistenceInvocation(app, "main")(input, work),
    maxAttempts: 1,
    listeners: [
      {
        name: "fails",
        event: "test.created",
        async handle() {
          stopping = worker.stop();
          void stopping.catch(() => {});
          throw failure;
        },
      },
    ],
  });
  const worker = createOutboxWorkerTransport(bindings.token);
  app = createApplication({
    providers: [],
    services: [
      ...bindings.services,
      ...createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        preparation: [bindings.token],
      }),
    ],
    transports: [worker.transport],
  });
  await app.start();
  const invoke = createPersistenceInvocation(app, "main");
  try {
    const outbox = await app.run((scope) => scope.resolve(bindings.token));
    await invoke({ kind: "command" }, async ({ database }) => {
      await createOutboxMigration("stop_failure", "sqlite").up({
        unsafe: async <T>(text: string, params: readonly unknown[] = []) =>
          Array.from(await database.execute<T>({ text, params })),
      });
      await database.transaction((selected) =>
        outbox.publish(
          selected,
          "test.created",
          {},
          {
            id: "host-stop-failure",
            tenantId: null,
          },
        ),
      );
    });
    await assert.rejects(bounded(worker.start()), (error) =>
      aggregateOccurrences(error).includes(failure),
    );
    await assert.rejects(bounded(stopping), (error) =>
      aggregateOccurrences(error).includes(failure),
    );
    await assert.rejects(bounded(worker.completion), (error) =>
      aggregateOccurrences(error).includes(failure),
    );
    await invoke({ kind: "command" }, async ({ database }) => {
      assert.equal(
        (await outbox.getDelivery(database, "host-stop-failure", "fails"))?.status,
        "failed",
      );
    });
    const stopped = await app.stop();
    assert.equal(
      stopped.successful,
      false,
      "The failed worker drain remains observable to its owner",
    );
    assert.ok(
      stopped.snapshot.errors.some((error) => aggregateOccurrences(error.error).includes(failure)),
    );
  } finally {
    await app.stop();
  }
});

function aggregateOccurrences(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(aggregateOccurrences) : [error];
}

for (const fault of ["none", "listener", "renewal"] as const)
  test(`application stop joins active outbox worker and retains independent ${fault} failure`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-outbox-app-stop-"));
    const filename = join(directory, "outbox.sqlite");
    const entered = deferred();
    const aborted = deferred();
    const release = deferred();
    const renewalEntered = deferred();
    const renewalRelease = deferred();
    const independent = new Error(`independent ${fault} failure`);
    let app!: ReturnType<typeof createApplication>;
    let effects = 0;
    const bindings = createSqlOutboxBindings({
      connection: "main",
      tenancy: "none",
      leaseMs: 300,
      invoke: async (input, work) => {
        if (
          fault === "renewal" &&
          input.actor?.kind === "system" &&
          input.actor.policy === "outbox.renew"
        ) {
          renewalEntered.resolve();
          await renewalRelease.promise;
          throw independent;
        }
        return createPersistenceInvocation(app, "main")(input, work);
      },
      listeners: [
        {
          name: "blocked",
          event: "stop.created",
          async handle(_event, { signal }) {
            signal.addEventListener("abort", () => aborted.resolve(), { once: true });
            entered.resolve();
            await release.promise;
            if (fault === "listener") throw independent;
            signal.throwIfAborted();
            effects++;
          },
        },
      ],
    });
    const worker = createOutboxWorkerTransport(bindings.token);
    app = createApplication({
      providers: [],
      services: [
        ...bindings.services,
        ...createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "sqlite", filename } },
          preparation: [bindings.token],
        }),
      ],
      transports: [worker.transport],
    });
    try {
      await app.start();
      const invoke = createPersistenceInvocation(app, "main");
      const outbox = await app.run((scope) => scope.resolve(bindings.token));
      await invoke({ kind: "command" }, async ({ database }) => {
        await createOutboxMigration("app_stop", "sqlite").up({
          unsafe: async <T>(text: string, params: readonly unknown[] = []) =>
            Array.from(await database.execute<T>({ text, params })),
        });
        await database.transaction((selected) =>
          outbox.publish(selected, "stop.created", {}, { tenantId: null, id: "app-stop" }),
        );
      });
      const running = worker.start();
      const observed = running.then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
      const completion = worker.completion.then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
      await bounded(entered.promise);
      if (fault === "renewal") await bounded(renewalEntered.promise);
      const closing = app.stop();
      await bounded(aborted.promise);
      await pending(closing);
      release.resolve();
      if (fault === "renewal") await pending(closing);
      renewalRelease.resolve();
      const stopped = await bounded(closing);
      const outcome = await bounded(observed);
      const completed = await bounded(completion);
      assert.equal(effects, 0);
      if (fault === "none") {
        assert.equal(stopped.successful, true);
        assert.deepEqual(stopped.snapshot.retainedResources, []);
        assert.deepEqual(stopped.snapshot.errors, []);
        assert.equal(outcome.ok, true);
        assert.equal(completed.ok, true);
      } else {
        assert.equal(stopped.successful, false);
        assert.equal(outcome.ok, false);
        assert.equal(completed.ok, false);
        if (!outcome.ok) assert.ok(aggregateOccurrences(outcome.error).includes(independent));
        if (!completed.ok) assert.ok(aggregateOccurrences(completed.error).includes(independent));
        assert.ok(
          stopped.snapshot.errors.some((error) =>
            aggregateOccurrences(error.error).includes(independent),
          ),
        );
      }
      const inspection = new Database(filename, { readonly: true });
      try {
        assert.deepEqual(
          inspection
            .query(
              "SELECT status, completed_at, error_code FROM strata_outbox_delivery WHERE event_id = ?",
            )
            .get("app-stop"),
          { status: "processing", completed_at: null, error_code: null },
        );
      } finally {
        inspection.close();
      }
    } finally {
      release.resolve();
      renewalRelease.resolve();
      await app.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("outbox worker validates configuration before acquisition and refuses polling outside its application lifetime", async () => {
  const token = createServiceToken<SqlOutbox>("outbox.worker.invalid-options");
  for (const options of [{ name: " " }, { pollMs: 0 }, { pollMs: Number.NaN }])
    assert.throws(
      () => createOutboxWorkerTransport(token, options),
      /Invalid outbox worker configuration/,
    );
  let invocations = 0;
  let app!: ReturnType<typeof createApplication>;
  const binding = createSqlOutboxBindings({
    connection: "main",
    tenancy: "none",
    listeners: [],
    invoke: (envelope, work) => {
      invocations++;
      return createPersistenceInvocation(app, "main")(envelope, work);
    },
  });
  const worker = createOutboxWorkerTransport(binding.token);
  app = createApplication({
    providers: [],
    transports: [worker.transport],
    services: [
      ...binding.services,
      ...createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        preparation: [binding.token],
      }),
    ],
  });
  try {
    await assert.rejects(worker.start(), /not available for admission/);
    assert.equal(app.state.phase, "constructed");
    await app.start();
    assert.equal(invocations, 0, "Transport setup must not admit outbox polling before ready");
    const result = await app.stop();
    assert.equal(result.successful, true);
    assert.deepEqual(result.snapshot.retainedResources, []);
    await bounded(worker.completion);
    await assert.rejects(worker.start(), /not available for admission/);
    await worker.stop();
    assert.equal(invocations, 0, "A closed transport cannot re-enter application work");
  } finally {
    await app.stop();
  }
});

import { existsSync } from "node:fs";
import type { ResourceSpec } from "@getstrata/core/contracts/application";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import type { RawPool } from "@getstrata/core/database/driverPorts";

for (const mode of ["sqlite-rls", "missing-connection", "postgres-single"] as const) {
  test(`authentic outbox startup refuses ${mode} before transport and confirms actual acquired-resource cleanup`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "outbox-configuration-"));
    const filename = join(directory, "owned.sqlite");
    let app!: ReturnType<typeof createApplication>;
    const binding = createSqlOutboxBindings({
      invoke: (input, work) => createPersistenceInvocation(app, "main")(input, work),
      connection: mode === "missing-connection" ? "missing" : "main",
      tenancy: mode === "missing-connection" ? "none" : "rls",
      listeners: [],
    });
    const declarations = createDatabaseBindings({
      default: "main",
      preparation: [binding.token],
      // Static PostgreSQL capability admission only: the original resource
      // descriptor must never open, and no native PostgreSQL behavior is claimed.
      connections: {
        main:
          mode === "postgres-single"
            ? { driver: "pgsql", url: "postgresql://unused.invalid/outbox-admission", max: 1 }
            : { driver: "sqlite", filename },
      },
    });
    const resource = declarations.find((entry) => entry.kind === "resource");
    assert.ok(resource?.kind === "resource");
    let opens = 0;
    let closes = 0;
    let transports = 0;
    app = createApplication({
      providers: [],
      services: [...declarations, ...binding.services],
      transports: [
        {
          name: "must-not-start",
          setup() {
            transports++;
          },
        },
      ],
      overrides: [
        resourceService(resource.token as ServiceToken<RawPool>, {
          lifetime: "application",
          dependencies: resource.dependencies,
          create: (...dependencies) => {
            const original = resource.create(...(dependencies as never[])) as ResourceSpec<RawPool>;
            return {
              ...original,
              open(signal) {
                opens++;
                return original.open(signal);
              },
              async close(pool, context) {
                closes++;
                await original.close?.(pool, context);
              },
            };
          },
        }),
      ],
    });
    try {
      await assert.rejects(
        app.start(),
        mode === "missing-connection"
          ? /Outbox connection is not configured/
          : /RLS outbox workers require PostgreSQL/,
      );
      const stopped = await app.stop();
      assert.equal(stopped.successful, true);
      assert.deepEqual(stopped.snapshot.retainedResources, []);
      assert.equal(transports, 0);
      if (mode === "postgres-single")
        assert.deepEqual(
          { opens, closes },
          { opens: 0, closes: 0 },
          "Static capability refusal must not open the original PostgreSQL resource descriptor",
        );
      assert.equal(closes, opens, "Every observed original native acquisition is closed once");
      assert.equal(
        existsSync(filename),
        opens > 0,
        "Report actual file acquisition rather than assuming pre-acquisition refusal",
      );
      assert.equal(await app.stop(), stopped);
      assert.equal(closes, opens);
      console.info(
        "[outbox-configuration-proof]",
        JSON.stringify({
          mode,
          opens,
          closes,
          transports,
          fileAcquired: existsSync(filename),
          cleanupSuccessful: stopped.successful,
        }),
      );
    } finally {
      await app.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const scenario of ["immediate-stop", "independent-failure"] as const)
  test(`outbox deferred admission preserves ${scenario} shutdown outcome`, async () => {
    const entered = deferred(),
      release = deferred();
    const failure = new Error("APPLICATION_NOT_READY");
    let invocations = 0;
    const binding = createSqlOutboxBindings({
      connection: "main",
      tenancy: "none",
      listeners: [],
      invoke: async () => {
        invocations++;
        entered.resolve();
        await release.promise;
        throw failure;
      },
    });
    const worker = createOutboxWorkerTransport(binding.token);
    const app = createApplication({
      providers: [],
      transports: [worker.transport],
      services: [
        ...binding.services,
        ...createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          preparation: [binding.token],
        }),
      ],
    });
    try {
      await app.start();
      const running = worker.start();
      if (scenario === "independent-failure") await bounded(entered.promise);
      const stopping = app.stop();
      release.resolve();
      if (scenario === "immediate-stop") {
        await bounded(running);
        const result = await bounded(stopping);
        assert.equal(
          invocations,
          0,
          "Stopping the owner before deferred admission must prevent its invocation.",
        );
        assert.equal(result.successful, true);
        assert.deepEqual(result.snapshot.retainedResources, []);
      } else {
        await assert.rejects(bounded(running), (error) => error === failure);
        await assert.rejects(bounded(worker.completion), (error) => error === failure);
        const result = await bounded(stopping);
        assert.equal(result.successful, false);
        assert.ok(
          result.snapshot.errors.some((error) =>
            aggregateOccurrences(error.error).includes(failure),
          ),
        );
      }
    } finally {
      release.resolve();
      await app.stop();
    }
  });
