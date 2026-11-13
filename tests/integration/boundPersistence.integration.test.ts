import { test } from "bun:test";
import assert from "node:assert/strict";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import {
  CORE_EXECUTION_OWNERSHIP_TOKEN,
  type OwnedExecution,
} from "@getstrata/core/contracts/executionOwnership";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { runWithScopedTenantTransaction } from "@getstrata/core/tenant/databaseTenantContext";
import { SQL } from "bun";
import { createScopedPolicy } from "../../src/core/tenant/scopedDatabasePolicy";
import { bounded, deferred, pending } from "../fixtures/applicationOwnershipSupport";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

type Settings = { tenant: string; bypass: string; identifier: string; pid: number };
const settings = {
  text: `SELECT current_setting('app.tenant_id', true) AS tenant,
  current_setting('app.bypass_rls', true) AS bypass,
  current_setting('app.bypass_identifier', true) AS identifier, pg_backend_pid() AS pid`,
  params: [],
};

// Explicit native fixture, no skip: the bounded PostgreSQL harness supplies this role/URL.
test("BP8 native PostgreSQL scoped policy joins descendant SQL, restores before RELEASE and rolls back cancelled restore", async () => {
  const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  assert.ok(url, "The owned PostgreSQL fixture must supply a restricted runtime URL");
  const adminUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(adminUrl, "The owned PostgreSQL fixture must supply its separate admin setup URL");
  const admin = new SQL(adminUrl);
  const scratch = `bound_policy_${crypto.randomUUID().replaceAll("-", "")}`;
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: {
        main: { driver: "pgsql", url, max: 2 },
        other: { driver: "pgsql", url, max: 1 },
      },
    }),
  });
  const bodyReturned = deferred();
  const descendantEntered = deferred();
  const releaseDescendant = deferred();
  const events: string[] = [];
  let before!: Settings;
  let inDescendant!: Settings;
  let after!: Settings;
  let wrongTenantEffects = 0;
  await app.start();
  const run = app.run({ kind: "command", tenant: { id: 1, slug: "one" } }, async (scope) => {
    const db = scope.resolve(DATABASE_SESSION_TOKEN);
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
      text: "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
      params: [],
    });
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    const ownership = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
    const operations = scope.resolve(CORE_EXECUTION_OPERATIONS_TOKEN);
    const policy = createScopedPolicy(ownership, scope.context, db);
    await assert.rejects(async () =>
      policy.run(db, { kind: "tenant", tenantId: 2 }, () => {
        wrongTenantEffects++;
      }),
    );
    await db.transaction(async (outer) => {
      await outer.execute({
        text: `SELECT set_config('app.tenant_id','7',true),
        set_config('app.bypass_rls','true',true), set_config('app.bypass_identifier','prior',true)`,
        params: [],
      });
      const rows = await outer.execute<Settings>(settings);
      assert.equal(rows.length, 1);
      before = rows[0] as Settings;
      const value = await policy.run(outer, { kind: "tenant", tenantId: 1 }, async (child) => {
        await assert.rejects(
          async () => outer.execute(settings),
          "The parent cannot borrow child policy authority",
        );
        await assert.rejects(
          async () => db.execute(settings),
          "The root cannot switch to an unrelated pool path",
        );
        void operations.operation(async () => {
          descendantEntered.resolve();
          await releaseDescendant.promise;
          const rows = await child.execute<Settings>(settings);
          assert.equal(rows.length, 1);
          inDescendant = rows[0] as Settings;
          events.push("descendant.sql");
        });
        events.push("callback.body.return");
        bodyReturned.resolve();
        return "body-value";
      });
      assert.equal(value, "body-value");
      const restored = await outer.execute<Settings>(settings);
      assert.equal(restored.length, 1);
      after = restored[0] as Settings;
      events.push("released.child.policy.restored");
    });
  });
  const actual = run.then(
    () => ({ ok: true as const }),
    (error) => ({ ok: false as const, error }),
  );
  try {
    await bounded(
      Promise.race([
        bodyReturned.promise,
        actual.then((outcome) => {
          if (!outcome.ok) throw outcome.error;
        }),
      ]),
      "scoped callback body",
    );
    await bounded(descendantEntered.promise);
    await pending(run);
    assert.deepEqual(
      events,
      ["callback.body.return"],
      "A held actual descendant prevents restore/RELEASE after body return",
    );
    releaseDescendant.resolve();
    const outcome = await bounded(actual);
    if (!outcome.ok) throw outcome.error;
    assert.equal(wrongTenantEffects, 0);
    assert.deepEqual(
      {
        tenant: inDescendant.tenant,
        bypass: inDescendant.bypass,
        identifier: inDescendant.identifier,
      },
      { tenant: "1", bypass: "false", identifier: "prior" },
    );
    assert.equal(inDescendant.pid, before.pid);
    assert.deepEqual(
      after,
      before,
      "SET LOCAL survives RELEASE, so parent settings prove explicit restoration before RELEASE",
    );
    assert.deepEqual(events, [
      "callback.body.return",
      "descendant.sql",
      "released.child.policy.restored",
    ]);

    const runtimeRole = await app.run(async (scope) => {
      const rows = await scope
        .resolve(DATABASE_SESSION_TOKEN)
        .execute<{ role: string }>({ text: "SELECT current_user AS role", params: [] });
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.ok(row);
      return row.role;
    });
    await admin.unsafe(`CREATE TABLE "${scratch}" (id INTEGER PRIMARY KEY)`);
    await admin.unsafe(
      `GRANT SELECT, INSERT ON TABLE "${scratch}" TO "${runtimeRole.replaceAll('"', '""')}"`,
    );
    const external = new AbortController();
    const reason = Object.freeze({ cancelled: "after-inner-join-before-restore-admission" });
    let cancelledAfterJoin = false;
    const cancelled = await app
      .run(
        { kind: "command", tenant: { id: 1, slug: "one" }, signal: external.signal },
        async (scope) => {
          const db = scope.resolve(DATABASE_SESSION_TOKEN);
          const real = scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN);
          const instrumented: OwnedExecution = {
            joined: (work, enter) =>
              real.joined(work, enter).then((observation) => {
                assert.equal(observation.body.ok, true);
                assert.equal(observation.strictFailed, false);
                cancelledAfterJoin = true;
                external.abort(reason);
                return observation;
              }),
          };
          return createScopedPolicy(instrumented, scope.context, db).run(
            db,
            { kind: "tenant", tenantId: 1 },
            async (child) => {
              await child.execute({
                text: `INSERT INTO "${scratch}" VALUES (1)`,
                params: [],
              });
              return "successful body before restore";
            },
          );
        },
      )
      .then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
    assert.equal(cancelledAfterJoin, true);
    assert.equal(
      cancelled.ok,
      false,
      "Cancelled restore admission must not become successful RELEASE or COMMIT",
    );
    await app.run(async (scope) => {
      assert.equal(
        (
          await scope
            .resolve(DATABASE_SESSION_TOKEN)
            .execute({ text: `SELECT id FROM "${scratch}"`, params: [] })
        ).length,
        0,
      );
    });
    const foreign = createApplication({
      providers: [],
      services: createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "pgsql", url, max: 1 } },
      }),
    });
    await foreign.start();
    let foreignEffects = 0;
    try {
      await app.run({ kind: "command", tenant: { id: 1, slug: "one" } }, async (ownerScope) => {
        const ownerPolicy = createScopedPolicy(
          ownerScope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
          ownerScope.context,
          ownerScope.resolve(DATABASE_SESSION_TOKEN),
        );
        await assert.rejects(
          async () =>
            ownerPolicy.run(
              ownerScope.resolve(DATABASE_SESSION_TOKEN).connection("other"),
              { kind: "tenant", tenantId: 1 },
              () => {
                foreignEffects++;
              },
            ),
          "An explicitly configured different pool cannot borrow selected policy authority",
        );
        await app.run({ kind: "command", tenant: { id: 1, slug: "one" } }, async (otherRun) => {
          await assert.rejects(
            async () =>
              ownerPolicy.run(
                otherRun.resolve(DATABASE_SESSION_TOKEN),
                { kind: "tenant", tenantId: 1 },
                () => {
                  foreignEffects++;
                },
              ),
            "A different run of the same app cannot borrow the captured policy authority",
          );
        });
        await foreign.run(
          { kind: "command", tenant: { id: 1, slug: "one" } },
          async (foreignScope) => {
            await assert.rejects(
              async () =>
                ownerPolicy.run(
                  foreignScope.resolve(DATABASE_SESSION_TOKEN),
                  { kind: "tenant", tenantId: 1 },
                  () => {
                    foreignEffects++;
                  },
                ),
              "A policy cannot mix one execution ownership tree with a foreign selected session",
            );
          },
        );
      });
      assert.equal(foreignEffects, 0);
    } finally {
      await foreign.stop();
    }
  } finally {
    releaseDescendant.resolve();
    await actual;
    await app.stop();
    try {
      await admin.unsafe(`DROP TABLE IF EXISTS "${scratch}"`);
    } finally {
      await admin.close();
    }
  }
}, 15000);

for (const mode of ["restricted", "privileged", "missing-role-protocol"] as const) {
  test(`native readiness ${mode} selects PostgreSQL before transport and closes the owned pool once`, async () => {
    const { resourceService } = await import("@getstrata/core/contracts/services");
    const { createDatabaseReadinessBindings } = await import(
      "../../src/bootstrap/databaseReadiness"
    );
    const runtimeUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
    const adminUrl = process.env.MIGRATION_DATABASE_URL;
    assert.ok(runtimeUrl, "Owned restricted PostgreSQL credentials are required");
    assert.ok(adminUrl, "Owned admin PostgreSQL credentials are required");
    const bindings = createDatabaseBindings({
      default: "main",
      connections: {
        main: { driver: "pgsql", url: mode === "privileged" ? adminUrl : runtimeUrl, max: 1 },
      },
    });
    const pool = bindings.find((declaration) => declaration.kind === "resource");
    assert.ok(pool);
    type RawPool = import("@getstrata/core/database/driverPorts").RawPool;
    type ResourceSpec<T> = import("@getstrata/core/contracts/application").ResourceSpec<T>;
    const originalCreate = pool.create as (...dependencies: unknown[]) => ResourceSpec<RawPool>;
    const queries: string[] = [];
    let closes = 0;
    let transports = 0;
    let observedRole: readonly { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[] = [];
    const app = createApplication({
      providers: [],
      services: [
        ...bindings,
        ...createDatabaseReadinessBindings("main", {
          TENANCY_DRIVER: "rls",
          APP_DATABASE_URL: runtimeUrl,
        }),
      ],
      overrides: [
        resourceService(
          pool.token as import("@getstrata/core/contracts/token").ServiceToken<RawPool>,
          {
            lifetime: "application",
            dependencies: pool.dependencies,
            create: (...dependencies) => {
              const specification = originalCreate(...dependencies);
              return {
                ...specification,
                open: async (context: Parameters<typeof specification.open>[0]) => {
                  const outcome = await specification.open(context);
                  if (!outcome.ok) return outcome;
                  const original = outcome.value;
                  const execute: RawPool["execute"] = async <Row>(
                    statement: import("@getstrata/core/database/driverPorts").SqlStatement,
                  ): Promise<readonly Row[]> => {
                    queries.push(statement.text);
                    const rows = await original.execute<Row>(statement);
                    if (statement.text.includes("FROM pg_roles")) {
                      observedRole = rows as readonly {
                        rolname: string;
                        rolsuper: boolean;
                        rolbypassrls: boolean;
                      }[];
                      if (mode === "missing-role-protocol") return []; // Explicit controlled empty-result fault after actual native query.
                    }
                    return rows;
                  };
                  // The native pool is frozen: delegate its actual operations through
                  // an explicit observation adapter rather than intercepting its properties.
                  const tracked: RawPool = {
                    dialect: original.dialect,
                    capabilities: original.capabilities,
                    execute,
                    checkout: (options) => original.checkout(options),
                    close: () => original.close(),
                  };
                  return { ok: true as const, value: tracked };
                },
                close: (owned, context) => {
                  closes++;
                  return specification.close?.(owned, context);
                },
              };
            },
          },
        ),
      ],
      transports: [
        {
          name: "readiness-gated transport",
          setup: () => {
            transports++;
          },
        },
      ],
    });
    try {
      if (mode === "restricted") await app.start();
      else await assert.rejects(app.start());
      assert.deepEqual(queries, [
        "SELECT 1",
        "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      ]);
      assert.equal(
        observedRole.length,
        1,
        "The real native role query must return its actual row before any controlled empty-result fault",
      );
      assert.equal(observedRole[0]?.rolsuper, mode === "privileged");
      if (mode !== "privileged") assert.equal(observedRole[0]?.rolbypassrls, false);
      assert.equal(transports, mode === "restricted" ? 1 : 0);
      if (mode !== "restricted") {
        let effects = 0;
        await assert.rejects(
          app.run(() => {
            effects++;
          }),
        );
        assert.equal(effects, 0);
        const errors = app.state.errors
          .flatMap((diagnostic) =>
            diagnostic.error instanceof Error ? [diagnostic.error.message] : [],
          )
          .join(" ");
        assert.match(
          errors,
          mode === "privileged"
            ? /superuser|BYPASSRLS|bypass RLS/i
            : /could not verify|role|inspect/i,
        );
      }
      assert.equal((await app.stop()).successful, true);
      assert.equal(closes, 1);
      assert.deepEqual(app.state.retainedResources, []);
      await app.stop();
      assert.equal(closes, 1);
    } finally {
      await app.stop();
    }
  });
}

test("native PostgreSQL public scoped transaction forwards its selected child and rejects malformed policy before SQL", async () => {
  const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  assert.ok(url, "Restricted PostgreSQL fixture required for public policy guarantees");
  const calls: string[] = [];
  const native = await createNativePersistenceApplication(
    {
      default: "main",
      connections: {
        main: { driver: "pgsql", url, max: 2 },
      },
    },
    (statement) => calls.push(statement.text),
  );
  try {
    const invoke = createPersistenceInvocation(native.application, "main");
    let before!: Settings;
    let childSettings!: Settings;
    let after!: Settings;
    let callbacks = 0;
    await invoke(
      {
        kind: "command",
        tenant: { id: 1 },
        actor: { kind: "system", policy: "policy.context-proof" },
      },
      async ({ database, policy }) => {
        const [role] = await database.execute<{
          role: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>({
          text: "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          params: [],
        });
        assert.ok(role);
        assert.equal(role.rolsuper, false);
        assert.equal(role.rolbypassrls, false);
        calls.length = 0;
        assert.throws(
          () =>
            runWithScopedTenantTransaction(
              database,
              policy,
              { kind: "forged" } as never,
              async () => {
                callbacks++;
                return "unreachable";
              },
            ),
          /Invalid established database policy/,
        );
        assert.throws(
          () => runWithScopedTenantTransaction(database, policy, { kind: "bypass" }, null as never),
          /Policy callback must be a function/,
        );
        assert.equal(callbacks, 0);
        assert.deepEqual(calls, [], "Neither malformed public policy nor callback may issue SQL");
        await database.transaction(async (outer) => {
          await outer.execute({
            text: "SELECT set_config('app.tenant_id','7',true),set_config('app.bypass_rls','true',true),set_config('app.bypass_identifier','prior',true)",
            params: [],
          });
          const [initial] = await outer.execute<Settings>(settings);
          assert.ok(initial);
          before = initial;
          const value = await runWithScopedTenantTransaction(
            outer,
            policy,
            { kind: "tenant", tenantId: 1 },
            async (child) => {
              callbacks++;
              assert.notEqual(
                child,
                outer,
                "Public helper must forward the actual selected policy child",
              );
              const [observed] = await child.execute<Settings>(settings);
              assert.ok(observed);
              childSettings = observed;
              assert.deepEqual(
                {
                  tenant: observed.tenant,
                  bypass: observed.bypass,
                  identifier: observed.identifier,
                },
                { tenant: "1", bypass: "false", identifier: "prior" },
              );
              assert.equal(
                observed.pid,
                before.pid,
                "Policy child uses the original native transaction pin",
              );
              return observed.pid;
            },
          );
          assert.equal(value, before.pid, "Public helper forwards the callback result");
          const [restored] = await outer.execute<Settings>(settings);
          assert.ok(restored);
          after = restored;
          assert.deepEqual(
            after,
            before,
            "All parent settings are restored before outer work resumes",
          );
        });
        assert.equal(callbacks, 1);
        console.log(
          "[context-policy-native-proof]",
          JSON.stringify({
            driver: database.dialect.driver,
            role,
            before,
            child: childSettings,
            after,
            rejectedBeforeSql: 2,
            callbacks,
          }),
        );
      },
    );
    const restored = await native.run((database) => database.execute<Settings>(settings));
    assert.notEqual(
      restored[0]?.bypass,
      "true",
      "Policy bypass never leaks beyond committed outer scope",
    );
  } finally {
    await native.close();
  }
});

test("native PostgreSQL policy rejects malformed tenant ID types before selected SQL or callback admission", async () => {
  const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
  assert.ok(url, "Existing restricted PostgreSQL fixture is required");
  let statements = 0;
  let callbacks = 0;
  const owner = await createNativePersistenceApplication(
    { default: "main", connections: { main: { driver: "pgsql", url, max: 1 } } },
    () => {
      statements++;
    },
  );
  try {
    await owner.application.run({ kind: "command", tenant: { id: 1 } }, async (scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      const [role] = await database.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
        text: "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user",
        params: [],
      });
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
      const policy = createScopedPolicy(
        scope.resolve(CORE_EXECUTION_OWNERSHIP_TOKEN),
        scope.context,
        database,
      );
      const before = statements;
      for (const tenantId of ["1", null, undefined, true, {}, [1]]) {
        assert.throws(
          () =>
            policy.run(database, { kind: "tenant", tenantId } as never, () => {
              callbacks++;
            }),
          { name: "TypeError", message: "Tenant identity must be a positive integer." },
        );
        assert.equal(
          statements,
          before,
          "Malformed policy cannot reach the original selected native SQL adapter",
        );
        assert.equal(callbacks, 0);
      }
      assert.deepEqual(
        [...(await database.execute({ text: "SELECT 97 AS value", params: [] }))],
        [{ value: 97 }],
      );
    });
  } finally {
    await owner.close();
  }
});
