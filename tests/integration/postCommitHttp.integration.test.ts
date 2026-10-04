import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { dispatchModelEvent, eventBus } from "@getstrata/core/events";
import { withErrorHandling } from "@getstrata/core/http/response";
import { appLogger } from "@getstrata/core/logging/logger";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import { SQL } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "../unit/testHelpers";

const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!restrictedUrl || !adminUrl)("real HTTP post-commit boundaries", () => {
  const table = `http_commit_${crypto.randomUUID().replaceAll("-", "")}`;
  const event = `${table}.created`;
  let pool: SQL;
  let admin: SQL;
  let previousPool: SqlDatabaseConnection;
  let previousBound: ReturnType<typeof getBoundDatabaseConnection>;
  let previousDriver: string | undefined;
  let previousMode: string | undefined;

  beforeAll(async () => {
    if (!restrictedUrl || !adminUrl)
      throw new Error("Dedicated restricted and admin test databases required.");
    pool = new SQL({ url: restrictedUrl, max: 5 });
    admin = new SQL(adminUrl);
    const [role] = await pool.unsafe<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    if (!role || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role))
      throw new Error("Invalid fixture role.");
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    await admin.unsafe(`CREATE TABLE ${table} (tenant_id INTEGER NOT NULL, value INTEGER UNIQUE DEFERRABLE INITIALLY DEFERRED);
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY scope ON ${table} USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::integer);
      GRANT SELECT, INSERT ON ${table} TO "${role.role}";`);
    previousPool = getDefaultDatabasePool();
    previousBound = getBoundDatabaseConnection();
    previousDriver = process.env.TENANCY_DRIVER;
    previousMode = process.env.FRONTEND_MODE;
    process.env.TENANCY_DRIVER = "rls";
    process.env.FRONTEND_MODE = "hybrid";
    registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
    resetBoundDatabaseConnection();
  });

  afterAll(async () => {
    if (previousPool) registerDefaultDatabasePool(previousPool);
    if (previousBound) bindDatabaseConnection(previousBound);
    else resetBoundDatabaseConnection();
    restoreEnvVar("TENANCY_DRIVER", previousDriver);
    restoreEnvVar("FRONTEND_MODE", previousMode);
    await admin?.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await pool?.close();
    await admin?.close();
  });

  for (const format of ["api", "web"] as const) {
    for (const failure of ["listener", "commit"] as const) {
      test(`${format} maps ${failure} failure after handler return and records final status`, async () => {
        await admin.unsafe(`DELETE FROM ${table}`);
        const container = new ServiceContainer();
        container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
        const dependencies = createMockDependencies(container);
        const path = `/qualification/${format}/${failure}`;
        let deliveries = 0;
        const unsubscribe = eventBus.listen(event, async () => {
          deliveries++;
          await Bun.sleep(20);
          throw new Error("Post-commit delivery failed.");
        });
        const info = spyOn(appLogger, "info").mockImplementation(() => {});
        const errors = spyOn(appLogger, "error").mockImplementation(() => {});
        prometheusRegistry.resetForTests();
        const effect = async () => {
          await db.unsafe(`INSERT INTO ${table} VALUES (1, 1)`);
          if (failure === "commit") await db.unsafe(`INSERT INTO ${table} VALUES (1, 1)`);
          await dispatchModelEvent(event, { value: 1 });
          return format === "api"
            ? Response.json({ accepted: true }, { status: 202 })
            : new Response(null, { status: 302, headers: { location: "/done" } });
        };
        const modules = [
          {
            name: table,
            routes: ({
              kernel,
            }: {
              kernel: ReturnType<typeof import("@getstrata/bootstrap/httpKernel").createHttpKernel>;
            }) => ({ [path]: { GET: kernel.wrap("api", withErrorHandling(effect)) } }),
            webRoutes: ({
              kernel,
            }: {
              kernel: ReturnType<typeof import("@getstrata/bootstrap/httpKernel").createHttpKernel>;
            }) => ({ [path]: { GET: kernel.wrapWeb(effect) } }),
          },
        ];
        const routes =
          format === "api"
            ? buildModuleRoutes(dependencies, { modules })
            : buildWebModuleRoutes(dependencies, { modules });
        const server = createWebServer({ port: 0, publicDir: "./public", routes });
        try {
          const response = await fetch(`http://localhost:${server.port}${path}`, {
            headers: { accept: "text/html" },
            redirect: "manual",
          });
          const status = failure === "listener" ? 500 : 409;
          expect(response.status).toBe(status);
          expect(response.headers.get("x-request-id")).toBeTruthy();
          if (format === "api") {
            expect(response.headers.get("content-type")).toContain("application/json");
            const body = await response.json();
            expect(body).not.toHaveProperty("accepted");
            expect(JSON.stringify(body)).not.toContain("Post-commit delivery failed");
          } else {
            expect(response.headers.get("content-type")).toContain("text/html");
            expect(response.headers.get("location")).toBeNull();
            expect(await response.text()).toContain("<html");
          }
          const rows = await admin.unsafe(`SELECT value FROM ${table}`);
          expect(rows.length).toBe(failure === "listener" ? 1 : 0);
          expect(deliveries).toBe(failure === "listener" ? 1 : 0);
          expect(prometheusRegistry.getHttpRequestSummary().byStatus).toEqual({
            [String(status)]: 1,
          });
          const completed = info.mock.calls.filter(
            ([message]) => message === "HTTP request completed",
          );
          expect(completed.length).toBe(1);
          expect(completed[0]?.[1]?.status).toBe(status);
          if (failure === "listener")
            expect(Number(completed[0]?.[1]?.durationMs)).toBeGreaterThanOrEqual(20);
        } finally {
          unsubscribe();
          info.mockRestore();
          errors.mockRestore();
          await server.stop(true);
        }
      });
    }
  }
});
