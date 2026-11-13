import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import type {
  Application,
  ExecutionContext,
  ExecutionEnvelope,
} from "@getstrata/core/contracts/application";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  type AfterCommitRepositoryContext,
  type AfterCommitRepositoryListener,
  defineRepository,
  repositoryEffects,
} from "@getstrata/core/database/definitions";
import { PersistenceError } from "@getstrata/core/database/errors";
import type { TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { createScopedPolicy } from "@getstrata/core/tenant/scopedDatabasePolicy";
import { SQL } from "bun";

type Row = { id: number; tenant_id: number; title: string };
function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded<T>(work: Promise<T>, label: string, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_done, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function present<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
// Negative-control observation accepts only canonical wrappers whose every leaf is this exact abort.
function checkoutCancellation(error: unknown, reason: unknown): boolean {
  if (error === reason) return true;
  if (error instanceof AggregateError)
    return (
      error.errors.length > 0 && error.errors.every((item) => checkoutCancellation(item, reason))
    );
  return (
    error instanceof PersistenceError &&
    error.code === "DATABASE_TRANSACTION_FAILED" &&
    error.data === "not-started" &&
    checkoutCancellation(error.cause, reason)
  );
}
const statement = (text: string, params: readonly unknown[] = []) => ({ text, params });

// Public-only fixture inputs permit the same suite to be copied into an installed package app.
async function fixture(
  work: (f: {
    table: string;
    definition: ReturnType<
      typeof defineRepository<Row, "id", BaseRepository<Row, "id">, readonly []>
    >;
    application: (label: string, listener: AfterCommitRepositoryListener<Row>) => Application;
    publish: (
      app: Application,
      row: Row,
      envelope: ExecutionEnvelope,
      before?: (context: ExecutionContext) => void | Promise<void>,
    ) => Promise<ExecutionContext>;
  }) => Promise<void>,
) {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error("MIGRATION_DATABASE_URL required for owned PG fixture");
  const control = new SQL({ url: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const name = `owned_effect_${crypto.randomUUID().replaceAll("-", "")}`;
  const role = `owned_effect_${crypto.randomUUID().replaceAll("-", "")}`;
  const table = `effect_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.MIGRATION_DATABASE_URL);
  url.pathname = `/${name}`;
  const password = crypto.randomUUID();
  const applications: Application[] = [];
  const failures: unknown[] = [];
  let owner: SQL | undefined;
  let created = false;
  let roleCreated = false;
  try {
    await control.unsafe(`CREATE DATABASE ${name}`);
    created = true;
    owner = new SQL({ url: url.href, max: 1 });
    await owner.unsafe(
      `CREATE TABLE ${table}(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,title TEXT NOT NULL)`,
    );
    await owner.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await owner.unsafe(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await owner.unsafe(
      `CREATE POLICY tenant_isolation ON ${table} USING (tenant_id::text=NULLIF(current_setting('app.tenant_id',true),'')) WITH CHECK (tenant_id::text=NULLIF(current_setting('app.tenant_id',true),''))`,
    );
    // The role is owned by this one fixture; no shared role/grant mutation.
    await control.unsafe(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    );
    roleCreated = true;
    await owner.unsafe(`GRANT CONNECT ON DATABASE ${name} TO ${role}`);
    await owner.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO ${role}`);
    const runtime = new URL(url);
    runtime.username = role;
    runtime.password = password;
    const definition = defineRepository({
      name: "NativeEffectNotes",
      table: defineTable<Row, "id">({
        name: table,
        primaryKey: "id",
        columns: ["id", "tenant_id", "title"],
      }),
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const First = createServiceToken<AfterCommitRepositoryListener<Row>>("native.context.first");
    const Second = createServiceToken<AfterCommitRepositoryListener<Row>>("native.context.second");
    const application = (label: string, listener: AfterCommitRepositoryListener<Row>) => {
      // Observer state is only a receipt for same-object assertion, never a policy/authority source.
      const receipts = new WeakMap<Readonly<Row>, AfterCommitRepositoryContext>();
      const app = createApplication({
        providers: [],
        services: [
          valueService(First, async (row, context) => {
            assert.equal(
              context.execution.metadata.app,
              label,
              "application-owned listener isolation",
            );
            assert.equal(context.execution.tenant?.id, row.tenant_id);
            assert.deepEqual(context.execution.actor, {
              kind: "principal",
              claims: { user: row.id, rights: ["publish"] },
            });
            assert.equal(Object.isFrozen(context), true);
            assert.equal(Object.isFrozen(context.policy), true);
            assert.equal(Object.isFrozen(context.execution), true);
            assert.equal(Object.isFrozen(context.execution.actor), true);
            assert.equal(Object.isFrozen(context.execution.tenant), true);
            assert.equal("ownership" in context, false);
            assert.equal("requestRollback" in context.database, false);
            assert.deepEqual(
              [...(await context.database.execute(statement(`SELECT id FROM ${table}`)))],
              [],
              "policy selection stays explicit; root SQL is unscoped",
            );
            let wrongCallbacks = 0;
            assert.throws(
              () =>
                context.policy.run(
                  context.database,
                  { kind: "tenant", tenantId: row.tenant_id + 100 },
                  () => {
                    wrongCallbacks++;
                  },
                ),
              /Established tenant identity mismatch/,
            );
            assert.throws(
              () =>
                context.policy.run(
                  context.database.connection("other"),
                  { kind: "tenant", tenantId: row.tenant_id },
                  () => {
                    wrongCallbacks++;
                  },
                ),
              /different application, execution or pool/,
            );
            assert.equal(wrongCallbacks, 0, "mismatch/pool refusal before callback effects");
            receipts.set(row, context);
            await listener(row, context);
          }),
          valueService(Second, (row, context) => {
            assert.equal(
              context,
              receipts.get(row),
              "one exact context for every listener in a publication",
            );
          }),
          ...createDatabaseBindings({
            default: "main",
            connections: {
              main: { driver: "pgsql", url: runtime.href, max: 1 },
              other: { driver: "pgsql", url: runtime.href, max: 1 },
            },
            repositories: [definition],
            repositoryEffects: [
              repositoryEffects(definition, [
                { action: "created", afterCommit: First },
                { action: "created", afterCommit: Second },
              ]),
            ],
          }),
        ],
      });
      applications.push(app);
      return app;
    };
    const publish = (
      app: Application,
      row: Row,
      envelope: ExecutionEnvelope,
      before?: (context: ExecutionContext) => void | Promise<void>,
    ) =>
      app.run(envelope, async (scope) => {
        const database = scope.resolve(DATABASE_SESSION_TOKEN);
        const policy = createScopedPolicy(
          scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
          scope.context,
          database,
        );
        await before?.(scope.context);
        await policy.run(database, { kind: "tenant", tenantId: row.tenant_id }, (tx) =>
          tx.repository(definition).create(row),
        );
        return scope.context;
      });
    await work({ table, definition, application, publish });
  } catch (error) {
    failures.push(error);
  } finally {
    for (const app of applications.reverse()) {
      try {
        const result = await app.stop();
        if (!result.successful)
          failures.push(new Error("Native effect application cleanup failed", { cause: result }));
      } catch (error) {
        failures.push(error);
      }
    }
    for (const close of [
      () => owner?.close(),
      async () => {
        if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      },
      async () => {
        if (roleCreated) await control.unsafe(`DROP ROLE ${role}`);
      },
      async () => {
        assert.deepEqual(
          [...(await control.unsafe("SELECT datname FROM pg_database WHERE datname=$1", [name]))],
          [],
        );
        assert.deepEqual(
          [...(await control.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]))],
          [],
        );
      },
      () => control.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Native effects and cleanup failed");
}
function envelope(app: string, id: number, tenantId: number, holdPin = false) {
  return {
    kind: "command" as const,
    metadata: { app, holdPin },
    actor: { kind: "principal" as const, claims: { user: id, rights: ["publish"] } },
    tenant: { id: tenantId, tags: ["trusted"] },
  };
}
async function visible(context: AfterCommitRepositoryContext, table: string) {
  const tenantId = context.execution.tenant?.id;
  assert.ok(typeof tenantId === "number");
  return context.policy.run(context.database, { kind: "tenant", tenantId }, async (selected) => {
    const [role] = await selected.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      statement("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"),
    );
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    const rows = await selected.execute<Row>(
      statement(`SELECT id,tenant_id,title FROM ${table} ORDER BY id`),
    );
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.tenant_id === tenantId));
    return rows;
  });
}

test("native repository listeners use exact immutable execution snapshots across overlapping tenants and applications", async () => {
  await fixture(async (f) => {
    const contexts: AfterCommitRepositoryContext[] = [];
    const first = f.application("first", async (row, context) => {
      contexts.push(context);
      assert.equal(
        (await visible(context, f.table)).some((value) => value.id === row.id),
        true,
      );
    });
    const second = f.application("second", async (row, context) => {
      contexts.push(context);
      assert.equal(
        (await visible(context, f.table)).some((value) => value.id === row.id),
        true,
      );
    });
    const entered = [gate(), gate(), gate()];
    const release = gate();
    const pending: Promise<ExecutionContext>[] = [];
    try {
      await first.start();
      await second.start();
      for (const [index, app, tenantId] of [
        [0, first, 1],
        [1, first, 2],
        [2, second, 1],
      ] as const) {
        const row = { id: index + 1, tenant_id: tenantId, title: `note-${index}` };
        const input = envelope(app === first ? "first" : "second", row.id, tenantId);
        const operation = f.publish(app, row, input, async (context) => {
          assert.notEqual(context.tenant, input.tenant);
          assert.notEqual(context.actor, input.actor);
          input.tenant.id = 999;
          input.tenant.tags.push("untrusted");
          input.actor.claims.user = 999;
          input.actor.claims.rights.push("mutated");
          input.metadata.app = "wrong";
          present(entered[index]).resolve();
          await release.promise;
        });
        void operation.catch(() => {
          for (const item of entered) item.resolve();
        });
        pending.push(operation);
      }
      await bounded(
        Promise.all(entered.map((item) => item.promise)),
        "overlapping invocation admission",
      );
      release.resolve();
      const results = await Promise.all(pending);
      expect(contexts).toHaveLength(3);
      expect(new Set(contexts).size).toBe(3);
      for (const context of contexts) {
        assert.ok(results.includes(context.execution));
        assert.deepEqual(context.execution.tenant?.tags, ["trusted"]);
      }
    } finally {
      release.resolve();
      await Promise.allSettled(pending);
    }
    for (const context of contexts) {
      await assert.rejects(context.database.execute(statement("SELECT 1")));
      await assert.rejects(async () => visible(context, f.table));
    }
  });
}, 30000);

test("native max-one pool is free during listener HTTP I/O; supplied policy reenters and refuses foreign/stale capabilities", async () => {
  await fixture(async (f) => {
    const httpEntered = gate();
    const releaseHttp = gate();
    const controlEntered = gate();
    const releaseControl = gate();
    let server: ReturnType<typeof Bun.serve> | undefined;
    let saved: AfterCommitRepositoryContext | undefined;
    let original: TransactionSession | undefined;
    const pending: Promise<unknown>[] = [];
    const failures: unknown[] = [];
    const main = f.application("main", async (row, context) => {
      if (row.id === 10 || row.id === 20) {
        if (row.id === 10) saved = context;
        const exchange = async () => {
          const response = await fetch(
            new URL(row.id === 10 ? "/effect" : "/control", present(server).url),
            { signal: AbortSignal.timeout(10000) },
          );
          assert.equal(await response.text(), "delivered");
        };
        if (context.execution.metadata.holdPin === true) {
          // Negative control: deliberately pinning across I/O prevents the other checkout.
          await context.policy.run(
            context.database,
            { kind: "tenant", tenantId: row.tenant_id },
            exchange,
          );
        } else await exchange();
        assert.equal(
          (await visible(context, f.table)).some((value) => value.id === row.id),
          true,
        );
        if (row.id === 10) await assert.rejects(present(original).execute(statement("SELECT 1")));
      } else await visible(context, f.table);
    });
    const other = f.application("other", async (_row, context) => {
      await visible(context, f.table);
    });
    try {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const isControl = new URL(request.url).pathname === "/control";
          (isControl ? controlEntered : httpEntered).resolve();
          await (isControl ? releaseControl : releaseHttp).promise;
          return new Response("delivered");
        },
      });
      await main.start();
      await other.start();
      const publishing = main.run(envelope("main", 10, 1), async (scope) => {
        const database = scope.resolve(DATABASE_SESSION_TOKEN);
        const policy = createScopedPolicy(
          scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
          scope.context,
          database,
        );
        return policy.run(database, { kind: "tenant", tenantId: 1 }, async (tx) => {
          original = tx;
          await tx.repository(f.definition).create({ id: 10, tenant_id: 1, title: "http" });
        });
      });
      pending.push(publishing);
      void publishing.catch(() => httpEntered.resolve());
      await bounded(httpEntered.promise, "actual listener HTTP request");
      const publication = present(saved);
      // These are independently started owners, never a nested invocation inside the listener.
      const reenter = main.run(envelope("main", 11, 2), async (scope) => {
        let admitted = 0;
        const database = scope.resolve(DATABASE_SESSION_TOKEN);
        assert.throws(
          () =>
            publication.policy.run(database, { kind: "tenant", tenantId: 1 }, () => {
              admitted++;
            }),
          /different application, execution or pool/,
        );
        assert.equal(admitted, 0, "same-app foreign execution refused");
        const policy = createScopedPolicy(
          scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
          scope.context,
          database,
        );
        await policy.run(database, { kind: "tenant", tenantId: 2 }, async (tx) => {
          await tx.repository(f.definition).create({ id: 11, tenant_id: 2, title: "free pool" });
        });
      });
      pending.push(reenter);
      const foreign = other.run(envelope("other", 12, 1), async (scope) => {
        let admitted = 0;
        const database = scope.resolve(DATABASE_SESSION_TOKEN);
        assert.throws(
          () =>
            publication.policy.run(database, { kind: "tenant", tenantId: 1 }, () => {
              admitted++;
            }),
          /different application, execution or pool/,
        );
        assert.equal(admitted, 0, "foreign app refused");
        await database.transaction((tx) => tx.execute(statement("SELECT 1")));
      });
      pending.push(foreign);
      await bounded(
        Promise.all([reenter, foreign]),
        "another invocation completes before HTTP gate release",
      );
      releaseHttp.resolve();
      await bounded(publishing, "listener reentry after HTTP");
      await assert.rejects(publication.database.execute(statement("SELECT 1")));
      await assert.rejects(async () => visible(publication, f.table));
      // Same witness's real negative control is sensitive to accidental pinning across I/O.
      const controlled = f.publish(
        main,
        { id: 20, tenant_id: 1, title: "control" },
        envelope("main", 20, 1, true),
      );
      pending.push(controlled);
      void controlled.catch(() => controlEntered.resolve());
      await bounded(controlEntered.promise, "control HTTP request while intentionally pinned");
      let controlBody = 0;
      const acquisitionSignal = AbortSignal.timeout(100);
      const blocked = main.run(envelope("main", 21, 2), (scope) =>
        scope.resolve(DATABASE_SESSION_TOKEN).transaction(
          () => {
            controlBody++;
          },
          { acquisitionSignal },
        ),
      );
      pending.push(
        blocked.then(
          () => {},
          (error) => {
            if (
              !acquisitionSignal.aborted ||
              !checkoutCancellation(error, acquisitionSignal.reason)
            )
              throw error;
          },
        ),
      );
      await assert.rejects(bounded(blocked, "control checkout cancellation"), (error) =>
        checkoutCancellation(error, acquisitionSignal.reason),
      );
      assert.equal(controlBody, 0);
      releaseControl.resolve();
      await bounded(controlled, "control request cleanup");
      await main.run((scope) =>
        scope
          .resolve(DATABASE_SESSION_TOKEN)
          .transaction((tx) => tx.execute(statement("SELECT 1"))),
      );
    } catch (error) {
      failures.push(error);
    } finally {
      releaseHttp.resolve();
      releaseControl.resolve();
      const outcomes = await Promise.allSettled(pending);
      for (const outcome of outcomes)
        if (outcome.status === "rejected") failures.push(outcome.reason);
      try {
        await server?.stop(true);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Listener and HTTP cleanup failed");
  });
}, 30000);
