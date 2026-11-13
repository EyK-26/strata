import { describe, expect, test } from "bun:test";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
import { resourceService } from "@getstrata/core/contracts/services";
import type { ServiceToken } from "@getstrata/core/contracts/token";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { createApplication } from "@getstrata/core/runtime/application";
import { currentTenant, runWithTenant } from "@getstrata/core/tenant/tenantContext";
import type {
  Decision,
  RawPin,
  RawPool,
  RawTransaction,
  SqlStatement,
  Terminal,
} from "../../src/core/database/driverPorts";
import { dialectFor } from "../../src/core/database/sqlDialects";
import { defaultTestTenant } from "./testHelpers";

type SqlCall = { query: string; params: readonly unknown[] };
async function fixture(
  work: (ports: ExecutionPersistence, calls: string[], sql: SqlCall[]) => Promise<void>,
  options: { wrapErrors?: boolean; sessionRow?: boolean; savepoints?: boolean } = {},
) {
  const calls: string[] = [],
    sql: SqlCall[] = [];
  const raw: RawTransaction = {
    async execute<T>(statement: SqlStatement) {
      sql.push({ query: statement.text, params: [...statement.params] });
      return (
        statement.text.includes("current_setting") && options.sessionRow !== false
          ? [{ tenant_id: "1", bypass_rls: "false", bypass_identifier: "" }]
          : []
      ) as T[];
    },
    async savepoint(work) {
      calls.push("savepoint");
      const decision = await work(raw);
      if (decision.finish === "rollback") calls.push("rollback-savepoint");
      return {
        data: decision.finish === "commit" ? "released" : "rolled-back",
        nativeState: "transaction-active",
        stage: { kind: "decided", decision },
        phases: [
          ...(decision.finish === "rollback"
            ? [
                {
                  phase: "rollback-to" as const,
                  acknowledgement: "confirmed-reply" as const,
                  failure: null,
                },
              ]
            : []),
          { phase: "release-savepoint", acknowledgement: "confirmed-reply", failure: null },
        ],
        failure: null,
      };
    },
  };
  const pin: RawPin = {
    async begin<R>(work: (tx: RawTransaction) => Promise<Decision<R>>): Promise<Terminal<R>> {
      calls.push("begin");
      const decision = await work(raw);
      calls.push(decision.finish);
      return {
        data: decision.finish === "commit" ? "committed" : "rolled-back",
        nativeState: "idle",
        stage: { kind: "decided", decision },
        phases: [
          { phase: "begin", acknowledgement: "confirmed-reply", failure: null },
          { phase: decision.finish, acknowledgement: "confirmed-reply", failure: null },
        ],
        failure:
          options.wrapErrors && decision.finish === "rollback"
            ? { error: new Error("wrapped driver rollback observation") }
            : null,
      };
    },
    async release() {
      return { ok: true };
    },
    async discard() {
      return { ok: true };
    },
  };
  const pool: RawPool = {
    dialect: dialectFor("pgsql"),
    capabilities: {
      driver: "pgsql",
      transactions: true,
      savepoints: options.savepoints !== false,
      rowLocks: true,
      postgresRls: true,
      cancellableCheckout: false,
      observableCheckout: false,
      isolatedDiscard: false,
    },
    execute: raw.execute,
    async checkout() {
      return { ok: true, value: pin };
    },
    close() {},
  };
  const services = createDatabaseBindings({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const declaration = services.find((value) => value.kind === "resource");
  if (declaration?.kind !== "resource") throw Error("Missing fixture resource");
  const app = createApplication({
    providers: [],
    services,
    overrides: [
      resourceService(declaration.token as ServiceToken<RawPool>, {
        lifetime: "application",
        dependencies: declaration.dependencies,
        create: () => ({
          name: "rollback-sql-fixture",
          open: () => ({ ok: true, value: pool }),
          close: () => {},
        }),
      }),
    ],
  });
  await app.start();
  try {
    await createPersistenceInvocation(app, "main")(
      { kind: "command", tenant: { id: 1 }, actor: { kind: "system", policy: "rollback-fixture" } },
      (ports) => runWithTenant(defaultTestTenant, () => work(ports, calls, sql)),
    );
  } finally {
    await app.stop();
  }
}
const tenant = { kind: "tenant" as const, tenantId: 1 };

describe("transaction rollback boundaries", () => {
  for (const wrapped of [false, true])
    test(
      wrapped
        ? "unwraps a driver error that wraps the rollback observation"
        : "rolls back before JSON error handling formats a thrown error",
      async () =>
        fixture(
          async ({ database, policy }, calls) => {
            const response = await withJsonErrorHandling(() =>
              policy.run(database, tenant, async () => {
                throw new Error("observer failed");
              }),
            )();
            expect(response.status).toBe(500);
            expect(calls).toContain("rollback");
            expect(calls).not.toContain("commit");
          },
          { wrapErrors: wrapped },
        ),
    );
  test("commits a returned 4xx response", async () =>
    fixture(async ({ database, policy }, calls) => {
      const response = await policy.run(
        database,
        tenant,
        async () => new Response("invalid", { status: 422 }),
      );
      expect(response.status).toBe(422);
      expect(calls).toContain("commit");
      expect(calls).not.toContain("rollback");
    }));
  test("propagates a thrown error and rolls back the outer transaction", async () =>
    fixture(async ({ database, policy }, calls) => {
      await expect(
        policy.run(database, tenant, async () => {
          throw new Error("db down");
        }),
      ).rejects.toThrow("db down");
      expect(calls).toContain("rollback");
      expect(calls).not.toContain("commit");
    }));
  test("rejects a different tenant before changing the database context", async () =>
    fixture(async ({ database, policy }, calls, sql) => {
      await policy.run(database, tenant, async (child) => {
        expect(() =>
          policy.run(child, { kind: "tenant", tenantId: 2 }, async () => undefined),
        ).toThrow("tenant identity mismatch");
        expect(currentTenant()?.id).toBe(1);
      });
      expect(
        sql
          .filter((call) => call.query.includes("set_config('app.tenant_id'"))
          .map((call) => call.params[0]),
      ).toEqual(["1", "1"]);
      expect(calls).not.toContain("savepoint");
      expect(calls).toContain("commit");
    }));
  test("rolls back a nested savepoint when the inner scope throws", async () =>
    fixture(async ({ database, policy }, calls) => {
      const result = await policy.run(database, tenant, async (child) => {
        try {
          await policy.run(child, tenant, async () => {
            throw new Error("inner");
          });
          return "unexpected";
        } catch (error) {
          return error instanceof Error ? error.message : "unknown";
        }
      });
      expect(result).toBe("inner");
      expect(calls).toContain("rollback-savepoint");
      expect(calls).toContain("commit");
      expect(calls).not.toContain("rollback");
    }));
  test("rolls back a nested savepoint before error handling returns a response", async () =>
    fixture(async ({ database, policy }, calls) => {
      const response = await policy.run(database, tenant, (child) =>
        withJsonErrorHandling(() =>
          policy.run(child, tenant, async () => {
            throw new Error("observer failed");
          }),
        )(),
      );
      expect(response.status).toBe(500);
      expect(calls).toContain("rollback-savepoint");
      expect(calls).toContain("commit");
      expect(calls).not.toContain("rollback");
    }));
  test("restores missing tenant session settings via canonical savepoints", async () =>
    fixture(
      async ({ database, policy }, calls, sql) => {
        await policy.run(database, tenant, async (child) => {
          await policy.run(child, tenant, async () => {
            expect(currentTenant()?.id).toBe(1);
          });
          expect(currentTenant()?.id).toBe(1);
        });
        expect(calls).toContain("savepoint");
        expect(sql.some((call) => call.params[0] === "")).toBe(true);
        expect(calls).toContain("commit");
      },
      { sessionRow: false },
    ));
  test("uses a savepoint for an explicit transaction inside an open tenant transaction", async () =>
    fixture(async ({ database, policy }, calls) => {
      const result = await policy.run(database, tenant, async (child) => {
        await expect(
          child.transaction(async () => {
            throw new Error("save");
          }),
        ).rejects.toThrow("save");
        return "outer-ok";
      });
      expect(result).toBe("outer-ok");
      expect(calls).toContain("rollback-savepoint");
      expect(calls).toContain("commit");
    }));
  test("rejects unsupported canonical savepoints before SQL", async () =>
    fixture(
      async ({ database }, calls, sql) => {
        await database.transaction(async (child) => {
          await expect(child.transaction(async () => undefined)).rejects.toMatchObject({
            code: "DATABASE_UNSUPPORTED_CAPABILITY",
          });
        });
        expect(calls).toEqual(["begin", "commit"]);
        expect(sql).toEqual([]);
      },
      { savepoints: false },
    ));
  test("requestRollback rolls back an explicit migration bypass transaction", async () =>
    fixture(async ({ database, policy }, calls) => {
      const result = await policy.run(database, { kind: "bypass" }, async (child) => {
        child.requestRollback();
        return "rolled";
      });
      expect(result).toBe("rolled");
      expect(calls).toContain("rollback");
      expect(calls).not.toContain("commit");
    }));
});
