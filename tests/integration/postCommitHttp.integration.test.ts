import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import type { BusinessRequestPorts } from "@getstrata/bootstrap/persistenceContracts";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { Schema } from "@getstrata/core/database/schema";
import { defineTable } from "@getstrata/core/database/table";
import { appLogger } from "@getstrata/core/logging/logger";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import { SQL } from "bun";
import { withBoundDatabase } from "../helpers/boundRepositoryHarness";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "../unit/testHelpers";

const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!restrictedUrl || !adminUrl)("real HTTP post-commit boundaries", () => {
  const table = `http_commit_${crypto.randomUUID().replaceAll("-", "")}`;
  let pool: SQL;
  let admin: SQL;
  let control: SQL;
  let createdDatabase = false;
  let runtimeDatabaseUrl: string;
  let previousDriver: string | undefined;
  let previousMode: string | undefined;

  beforeAll(async () => {
    if (!restrictedUrl || !adminUrl)
      throw new Error("Dedicated restricted and admin test databases required.");
    previousDriver = process.env.TENANCY_DRIVER;
    previousMode = process.env.FRONTEND_MODE;
    // A cold CI database must not depend on retired app migrations or old local data.
    const maintenanceUrl = new URL(adminUrl);
    maintenanceUrl.pathname = "/postgres";
    control = new SQL(maintenanceUrl.href);
    await control.unsafe(`CREATE DATABASE ${table}`);
    createdDatabase = true;
    const runtimeUrl = new URL(restrictedUrl),
      migrationUrl = new URL(adminUrl);
    runtimeUrl.pathname = migrationUrl.pathname = `/${table}`;
    runtimeDatabaseUrl = runtimeUrl.href;
    pool = new SQL({ url: runtimeDatabaseUrl, max: 5 });
    admin = new SQL(migrationUrl.href);
    const [role] = await pool.unsafe<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    if (!role || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role.role))
      throw new Error("Invalid fixture role.");
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    await Schema.run(admin, "pgsql", (schema) => {
      schema.create("tenant", (columns) => {
        columns.integer("id").primary();
        columns.text("slug");
      });
    });
    await admin.unsafe("INSERT INTO tenant(id,slug) VALUES($1,$2)", [1, "post-commit-fixture"]);
    await admin.unsafe(`GRANT USAGE ON SCHEMA public TO "${role.role}";
      GRANT SELECT ON tenant TO "${role.role}";`);
    await admin.unsafe(`CREATE TABLE ${table} (tenant_id INTEGER NOT NULL, value INTEGER UNIQUE DEFERRABLE INITIALLY DEFERRED);
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY scope ON ${table} USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::integer);
      GRANT SELECT, INSERT ON ${table} TO "${role.role}";`);
    process.env.TENANCY_DRIVER = "rls";
    process.env.FRONTEND_MODE = "hybrid";
    await pool.close();
  });

  afterAll(async () => {
    restoreEnvVar("TENANCY_DRIVER", previousDriver);
    restoreEnvVar("FRONTEND_MODE", previousMode);
    try {
      await admin?.unsafe(`DROP TABLE IF EXISTS ${table}`);
    } finally {
      try {
        try {
          // The one-off restricted role inspection connection closed during setup.
        } finally {
          await admin?.close();
        }
      } finally {
        try {
          if (createdDatabase) await control.unsafe(`DROP DATABASE ${table} WITH (FORCE)`);
        } finally {
          await control?.close();
        }
      }
    }
  });

  for (const format of ["api", "web"] as const) {
    for (const failure of ["listener", "commit"] as const) {
      test(`${format} maps ${failure} failure after handler return and records final status`, async () => {
        await admin.unsafe(`DELETE FROM ${table}`);
        const path = `/qualification/${format}/${failure}`;
        let deliveries = 0;
        type Row = { tenant_id: number; value: number };
        const listener =
          createServiceToken<AfterCommitRepositoryListener<Row>>("post-commit-listener");
        const definition = defineRepository({
          name: "PostCommitRows",
          table: defineTable<Row, "value">({
            name: table,
            primaryKey: "value",
            columns: ["tenant_id", "value"],
          }),
          dependencies: [],
          create: (binding) => new BaseRepository(binding),
          effects: [{ action: "created", afterCommit: listener }],
        });
        await withBoundDatabase(
          {
            definition: {
              default: "main",
              connections: { main: { driver: "pgsql", url: runtimeDatabaseUrl, max: 5 } },
              repositories: [definition],
            },
            services: [
              valueService(listener, async () => {
                deliveries++;
                await Bun.sleep(20);
                throw new Error("Post-commit delivery failed.");
              }),
            ],
          },
          async (_database, invoke) => {
            const container = new ServiceContainer();
            container.set(
              CORE_AUTH_TOKEN,
              new AuthManager(
                new GuestGuard({
                  production: false,
                  allowDevHeaders: false,
                  abilities: { admin: [], member: [] },
                }),
              ),
            );
            const dependencies = createMockDependencies(
              container,
              undefined,
              undefined,
              (envelope, work) =>
                invoke((database, policy) => work({ database, policy }), envelope),
              {
                tenancy: "rls",
                production: false,
                allowTenantDevHeaders: false,
                metadata: () => ({
                  authenticate: async () => ({
                    status: "absent",
                    user: null,
                    credentialSource: null,
                  }),
                  memberships: async () => [],
                  userTenantId: async () => 1,
                  tenant: async (id) => (id === 1 ? { id, slug: "post-commit-fixture" } : null),
                }),
              },
            );
            const info = spyOn(appLogger, "info").mockImplementation(() => {});
            const errors = spyOn(appLogger, "error").mockImplementation(() => {});
            prometheusRegistry.resetForTests();
            const effect = async (_request: Request, ports: BusinessRequestPorts) => {
              await ports.database.repository(definition).create({ tenant_id: 1, value: 1 });
              if (failure === "commit")
                await ports.database.repository(definition).create({ tenant_id: 1, value: 1 });
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
                  kernel: ReturnType<
                    typeof import("@getstrata/bootstrap/httpKernel").createHttpKernel
                  >;
                }) => ({ [path]: { GET: kernel.wrap("api", effect) } }),
                webRoutes: ({
                  kernel,
                }: {
                  kernel: ReturnType<
                    typeof import("@getstrata/bootstrap/httpKernel").createHttpKernel
                  >;
                }) => ({ [path]: { GET: kernel.wrapWeb(effect) } }),
              },
            ];
            const routes =
              format === "api"
                ? buildModuleRoutes(dependencies, { modules })
                : buildWebModuleRoutes(dependencies, { modules });
            const server = createWebServer({
              port: 0,
              native: { hostname: "127.0.0.1" },
              publicDir: "./public",
              routes,
            });
            try {
              const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
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
              info.mockRestore();
              errors.mockRestore();
              await server.stop(true);
            }
          },
        );
      });
    }
  }
});
