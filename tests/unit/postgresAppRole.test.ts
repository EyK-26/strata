import { describe, expect, test } from "bun:test";
import { ensurePostgresDatabaseAndAppRole as ensureFromEnableTenantRls } from "../../src/core/tenant/enableTenantRls.ts";
import {
  assertPostgresRoleCannotBypassRls,
  assertSafeSqlIdentifier,
  dropPostgresTablesAsAdmin,
  ensurePostgresAppRole,
  ensurePostgresDatabaseAndAppRole,
  grantPostgresAppRolePrivileges,
  inspectCurrentPostgresRole,
  isPostgresUrl,
  openPostgresAdminConnection,
  POSTGRES_APP_ROLE,
  POSTGRES_APP_ROLE_PASSWORD,
  POSTGRES_SUPERUSER_PASSWORD,
  type PostgresSql,
  postgresAdminUrls,
  postgresAppRoleCreateSql,
  postgresAppRoleSql,
  postgresDatabaseNameFromUrl,
  postgresUrlUsername,
  quoteSqlLiteral,
} from "../../src/core/tenant/postgresAppRole.ts";
import { restoreEnvVar } from "../helpers/restoreEnv";

function createFakeCluster(existing: string[] = []) {
  const databases = new Set(existing);
  const calls: string[] = [];
  const tried: string[] = [];
  return {
    calls,
    tried,
    connect(url: string): PostgresSql {
      tried.push(url);
      return {
        async unsafe<T>(query: string, params?: readonly unknown[]) {
          calls.push(`${query} ${JSON.stringify(params ?? [])} @${new URL(url).pathname}`);
          if (query === "SELECT 1") {
            return [] as T[];
          }
          if (query.includes("FROM pg_database")) {
            const name = String(params?.[0] ?? "");
            if (databases.has(name)) {
              return [{ ok: 1 }] as T[];
            }
            return [] as T[];
          }
          if (query.startsWith("CREATE DATABASE ")) {
            databases.add(query.slice("CREATE DATABASE ".length).trim());
          }
          if (query.includes("FROM pg_roles")) {
            return [{ rolname: "strata_app", rolsuper: false, rolbypassrls: false }] as T[];
          }
          return [] as T[];
        },
        async close() {
          calls.push(`close ${new URL(url).pathname}`);
        },
      };
    },
  };
}

function fakeSql(
  calls: string[],
  options: { failPing?: boolean; databases?: string[] } = {},
): PostgresSql {
  return {
    async unsafe<T>(query: string, params?: readonly unknown[]) {
      calls.push(`${query} ${JSON.stringify(params ?? [])}`);
      if (options.failPing && query === "SELECT 1") {
        throw new Error("ping failed");
      }
      if (query.includes("FROM pg_database")) {
        const name = String(params?.[0] ?? "");
        if ((options.databases ?? ["hiroapp"]).includes(name)) {
          return [{ ok: 1 }] as T[];
        }
        return [] as T[];
      }
      if (query.includes("FROM pg_roles")) {
        return [{ rolname: "strata_app", rolsuper: false, rolbypassrls: false }] as T[];
      }
      return [] as T[];
    },
    async close() {
      calls.push("close");
    },
  };
}

describe("postgresAppRole", () => {
  test("rejects unsafe identifiers and quotes passwords", () => {
    expect(() => assertSafeSqlIdentifier("strata-app", "role name")).toThrow(
      /unsafe Postgres role name/,
    );
    expect(quoteSqlLiteral("dev-strata-app-change-me")).toBe("'dev-strata-app-change-me'");
    expect(quoteSqlLiteral("o'reilly")).toBe("'o''reilly'");
    expect(isPostgresUrl("sqlite:./app.sqlite")).toBe(false);
    expect(isPostgresUrl("not a url")).toBe(false);
    expect(postgresUrlUsername("postgresql://strata_app:secret@localhost/app")).toBe("strata_app");
    expect(postgresUrlUsername("")).toBeNull();
    expect(postgresUrlUsername("   ")).toBeNull();
    expect(postgresUrlUsername("postgres://localhost/app")).toBe("");
    expect(postgresUrlUsername("mysql://root@localhost/app")).toBeNull();
  });

  test("requires a safe database name in the URL", () => {
    expect(() => postgresDatabaseNameFromUrl("not a url")).toThrow("not a valid URL");
    expect(() => postgresDatabaseNameFromUrl("postgresql://strata_app@localhost")).toThrow(
      "missing a database name",
    );
    expect(() => postgresDatabaseNameFromUrl("postgresql://strata_app@localhost/bad-name")).toThrow(
      "unsafe Postgres database name",
    );
    expect(postgresDatabaseNameFromUrl("postgresql://strata_app@localhost/hiroapp")).toBe(
      "hiroapp",
    );
  });

  test("lists migration URL then compose and legacy superuser URLs", () => {
    const urls = postgresAdminUrls({
      runtimeUrl: "postgresql://strata_app:dev-strata-app-change-me@localhost:54329/hiroapp_test",
      migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost:54329/hiroapp_test",
    });
    expect(urls[0]).toContain("postgres:dev-postgres-change-me");
    expect(urls.some((url) => /:\/\/postgres:postgres@/.test(url))).toBe(true);
    expect(urls.some((url) => url.includes("strata_app"))).toBe(false);
    expect(POSTGRES_SUPERUSER_PASSWORD).toBe("dev-postgres-change-me");
    expect(POSTGRES_APP_ROLE).toBe("strata_app");
    expect(POSTGRES_APP_ROLE_PASSWORD).toBe("dev-strata-app-change-me");
  });

  test("omits the legacy postgres password when APP_ENV is production", () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      const urls = postgresAdminUrls({
        runtimeUrl: "postgresql://strata_app:dev-strata-app-change-me@localhost:54329/hiroapp_test",
        migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost:54329/hiroapp_test",
      });
      expect(urls.some((url) => /:\/\/postgres:postgres@/.test(url))).toBe(false);
    } finally {
      restoreEnvVar("APP_ENV", previous);
    }
  });

  test("SQL creates the role idempotently and grants existing tables", () => {
    const sql = postgresAppRoleSql({ database: "hiroapp" });
    expect(sql).toContain("NOBYPASSRLS");
    expect(sql).toContain("already-existing volume");
    expect(sql).toContain("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public");
    expect(sql).toContain("ALTER ROLE strata_app WITH LOGIN PASSWORD");
    expect(postgresAppRoleCreateSql()).toContain("CREATE ROLE strata_app LOGIN");
  });

  test("opens an admin connection to the runtime database, not postgres/template1", async () => {
    const cluster = createFakeCluster(["hiroapp"]);
    const sql = await openPostgresAdminConnection({
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost/hiroapp",
      connect: cluster.connect,
    });
    await sql.close?.();
    expect(cluster.tried[0]).toMatch(/\/hiroapp$/);
    expect(cluster.tried.some((url) => /\/postgres$/.test(new URL(url).pathname))).toBe(false);
    expect(cluster.tried.some((url) => /\/template1$/.test(new URL(url).pathname))).toBe(false);
  });

  test("fails closed when every admin candidate fails", async () => {
    await expect(
      openPostgresAdminConnection({
        runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
        connect: () => ({
          async unsafe() {
            throw "not-an-error";
          },
        }),
      }),
    ).rejects.toThrow("Could not open a Postgres superuser connection");
  });

  test("creates a missing database on a maintenance DB then GRANTs on the target", async () => {
    const cluster = createFakeCluster([]);
    const previous = process.env.STRATA_APP_PASSWORD;
    process.env.STRATA_APP_PASSWORD = "custom-app-secret";
    try {
      await ensurePostgresDatabaseAndAppRole({
        runtimeUrl: "postgresql://strata_app:secret@localhost/newdb",
        migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost/postgres",
        connect: cluster.connect,
      });
      expect(cluster.calls.some((line) => line.includes("CREATE DATABASE newdb"))).toBe(true);
      expect(
        cluster.calls.some(
          (line) => line.includes("CREATE DATABASE newdb") && line.includes("@/postgres"),
        ),
      ).toBe(true);
      expect(cluster.calls.some((line) => line.includes("CREATE ROLE"))).toBe(true);
      expect(
        cluster.calls.some(
          (line) => line.includes("GRANT ALL PRIVILEGES ON ALL TABLES") && line.includes("@/newdb"),
        ),
      ).toBe(true);
    } finally {
      restoreEnvVar("STRATA_APP_PASSWORD", previous);
    }
  });

  test("skips CREATE DATABASE when the name already exists", async () => {
    const cluster = createFakeCluster(["hiroapp"]);
    await ensurePostgresDatabaseAndAppRole({
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      connect: cluster.connect,
    });
    expect(cluster.calls.some((line) => line.includes("CREATE DATABASE"))).toBe(false);
  });

  test("inspects the live role and rejects bypass capabilities", async () => {
    const allowed = await inspectCurrentPostgresRole(fakeSql([]));
    expect(allowed).toEqual({ rolname: "strata_app", rolsuper: false, rolbypassrls: false });
    assertPostgresRoleCannotBypassRls(allowed, "APP_DATABASE_URL");
    expect(() => assertPostgresRoleCannotBypassRls(null)).toThrow(/could not inspect/);
    expect(() =>
      assertPostgresRoleCannotBypassRls(
        { rolname: "deploy", rolsuper: true, rolbypassrls: false },
        "DATABASE_URL",
      ),
    ).toThrow(/role deploy is rolsuper or rolbypassrls/);
    expect(() =>
      assertPostgresRoleCannotBypassRls({
        rolname: "app",
        rolsuper: false,
        rolbypassrls: true,
      }),
    ).toThrow(/role app is rolsuper or rolbypassrls/);
  });

  test("grantPostgresAppRolePrivileges is a separate repeatable GRANT path", async () => {
    const calls: string[] = [];
    await grantPostgresAppRolePrivileges(fakeSql(calls), { database: "hiroapp" });
    expect(calls.some((line) => line.includes("GRANT CONNECT ON DATABASE hiroapp"))).toBe(true);
    await ensurePostgresAppRole(fakeSql(calls), { database: "hiroapp" });
  });

  test("reruns GRANT on an already-existing database without CREATE DATABASE", async () => {
    const cluster = createFakeCluster(["hiroapp"]);
    await ensurePostgresDatabaseAndAppRole({
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      connect: cluster.connect,
    });
    expect(cluster.calls.some((line) => line.includes("CREATE DATABASE"))).toBe(false);
    expect(cluster.calls.some((line) => line.includes("GRANT ALL PRIVILEGES ON ALL TABLES"))).toBe(
      true,
    );
    expect(ensureFromEnableTenantRls).toBe(ensurePostgresDatabaseAndAppRole);
  });

  test("lists only the migration URL when the runtime URL is not Postgres", () => {
    const urls = postgresAdminUrls({
      runtimeUrl: "sqlite:./storage/app.sqlite",
      migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost/hiroapp",
    });
    expect(urls).toEqual(["postgresql://postgres:dev-postgres-change-me@localhost/hiroapp"]);
  });

  test("uses Bun.SQL when no connect override is provided", async () => {
    await expect(
      openPostgresAdminConnection({
        runtimeUrl: "postgresql://strata_app:secret@127.0.0.1:1/hiroapp",
      }),
    ).rejects.toThrow();
  });

  test("falls back to the raw admin URL when it is not parseable", async () => {
    const tried: string[] = [];
    await expect(
      openPostgresAdminConnection({
        runtimeUrl: "sqlite:./storage/app.sqlite",
        migrationUrl: "::::",
        connect: (url) => {
          tried.push(url);
          return {
            async unsafe() {
              throw new Error("ping failed");
            },
          };
        },
      }),
    ).rejects.toThrow("ping failed");
    expect(tried).toEqual(["::::"]);
  });

  test("inspectCurrentPostgresRole returns null when pg_roles is empty", async () => {
    const sql: PostgresSql = {
      async unsafe() {
        return [];
      },
    };
    expect(await inspectCurrentPostgresRole(sql)).toBeNull();
  });

  test("dropPostgresTablesAsAdmin drops as the superuser on the app database", async () => {
    const cluster = createFakeCluster(["hiroapp"]);
    await dropPostgresTablesAsAdmin(["notes", "users"], {
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost/hiroapp",
      connect: cluster.connect,
    });
    expect(cluster.tried[0]).toMatch(/\/hiroapp$/);
    expect(cluster.calls.some((line) => line.includes("DROP TABLE IF EXISTS notes CASCADE"))).toBe(
      true,
    );
    expect(cluster.calls.some((line) => line.includes("DROP TABLE IF EXISTS users CASCADE"))).toBe(
      true,
    );
  });

  test("dropPostgresTablesAsAdmin rejects unsafe table names before connecting", async () => {
    const tried: string[] = [];
    await expect(
      dropPostgresTablesAsAdmin(["notes;drop"], {
        runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
        connect: (url) => {
          tried.push(url);
          return fakeSql([]);
        },
      }),
    ).rejects.toThrow(/unsafe Postgres table name/);
    expect(tried).toEqual([]);
  });

  test("dropPostgresTablesAsAdmin still closes when DROP throws", async () => {
    const sql: PostgresSql = {
      async unsafe(query: string) {
        if (query === "SELECT 1") {
          return [];
        }
        throw new Error("cannot drop");
      },
    };
    await expect(
      dropPostgresTablesAsAdmin(["notes"], {
        runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
        connect: () => sql,
      }),
    ).rejects.toThrow("cannot drop");
  });

  test("ignores close failures after a successful DROP", async () => {
    await dropPostgresTablesAsAdmin(["notes"], {
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      connect: () => ({
        async unsafe(query: string) {
          if (query === "SELECT 1") {
            return [];
          }
          return [];
        },
        async close() {
          throw new Error("close failed");
        },
      }),
    });
  });

  test("skips a failed ping candidate and uses the next admin URL", async () => {
    let pings = 0;
    const sql = await openPostgresAdminConnection({
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      connect: () => ({
        async unsafe(query: string) {
          if (query === "SELECT 1") {
            pings += 1;
            if (pings === 1) {
              throw new Error("first ping failed");
            }
            return [];
          }
          return [];
        },
        async close() {
          if (pings === 1) {
            throw new Error("close after failed ping");
          }
        },
      }),
    });
    expect(pings).toBe(2);
    await sql.close?.();
  });

  test("rewrites a postgres migration URL when the runtime URL is sqlite", async () => {
    const cluster = createFakeCluster(["hiroapp"]);
    const sql = await openPostgresAdminConnection({
      runtimeUrl: "sqlite:./storage/app.sqlite",
      migrationUrl: "postgresql://postgres:dev-postgres-change-me@localhost/hiroapp",
      connect: cluster.connect,
    });
    await sql.close?.();
    expect(cluster.tried[0]).toMatch(/\/hiroapp$/);
  });

  test("skips non-postgres and unparseable admin URLs when rewriting the target database", async () => {
    const tried: string[] = [];
    const sql = await openPostgresAdminConnection({
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      migrationUrl: "http://localhost/not-pg",
      connect: (url) => {
        tried.push(url);
        return fakeSql([], { failPing: url.startsWith("http://") || url.includes("::::") });
      },
    });
    await sql.close?.();
    expect(tried).toContain("http://localhost/not-pg");
    expect(tried.some((url) => url.includes("/hiroapp"))).toBe(true);

    const unparseable: string[] = [];
    const recovered = await openPostgresAdminConnection({
      runtimeUrl: "postgresql://strata_app:secret@localhost/hiroapp",
      migrationUrl: "::::",
      connect: (url) => {
        unparseable.push(url);
        return fakeSql([], { failPing: url === "::::" });
      },
    });
    await recovered.close?.();
    expect(unparseable).toContain("::::");
  });
});
