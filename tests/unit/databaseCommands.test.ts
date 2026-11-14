import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { currentSqlDialect } from "@getstrata/core/database/dialect";
import {
  ensureDatabase,
  resolveDatabaseOptions,
  withMigrationDatabase,
} from "../../src/bootstrap/databaseCommands";

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("database configuration copies explicit URLs and limits network defaults to development", () => {
  const defaults = {
    driver: "pgsql" as const,
    defaultUrl: "postgresql://app:secret@localhost/default",
  };
  const env = { APP_ENV: "local", DATABASE_URL: "postgresql://runtime:secret@localhost/selected" };
  const resolved = resolveDatabaseOptions(env, defaults);
  env.DATABASE_URL = "changed";
  expect(resolved).toEqual({
    driver: "pgsql",
    url: "postgresql://runtime:secret@localhost/selected",
    max: 5,
  });
  expect(
    resolveDatabaseOptions(
      { APP_DATABASE_URL: "mysql://app@localhost/override", DATABASE_URL: "ignored" },
      { driver: "mysql" },
    ),
  ).toEqual({ driver: "mysql", url: "mysql://app@localhost/override" });
  expect(resolveDatabaseOptions({ APP_ENV: "local" }, defaults)).toEqual({
    driver: "pgsql",
    url: defaults.defaultUrl,
    max: 5,
  });
  for (const APP_ENV of ["production", "staging"])
    expect(() => resolveDatabaseOptions({ APP_ENV }, defaults)).toThrow("required");
  expect(
    resolveDatabaseOptions(
      { APP_ENV: "production" },
      { driver: "sqlite", defaultUrl: "sqlite:./storage/app.sqlite" },
    ),
  ).toEqual({ driver: "sqlite", filename: resolve("./storage/app.sqlite") });
});

test("production database resolution performs no provisioning or environment mutation", async () => {
  const previous = process.env.DATABASE_URL;
  for (const driver of ["pgsql", "mysql"] as const) {
    const url = `${driver}://runtime@unreachable/existing`;
    expect(await ensureDatabase({ driver, runtimeUrl: url, production: true })).toBe(url);
    expect(
      await ensureDatabase({ driver, runtimeUrl: url, production: false, provision: false }),
    ).toBe(url);
  }
  expect(process.env.DATABASE_URL).toBe(previous);
});

test("provisioning validates administrative credentials and identifiers before connecting", async () => {
  const options = {
    driver: "pgsql" as const,
    runtimeUrl: "postgresql://runtime@localhost/app",
    production: true,
    provision: true,
  };
  await expect(ensureDatabase(options)).rejects.toThrow("MIGRATION_DATABASE_URL");
  await expect(
    ensureDatabase({ ...options, migrationUrl: "postgresql://admin@localhost/app" }),
  ).rejects.toThrow("STRATA_APP_PASSWORD");
  await expect(
    ensureDatabase({
      ...options,
      migrationUrl: "postgresql://admin@localhost/app",
      password: "dev-strata-app-change-me",
    }),
  ).rejects.toThrow("STRATA_APP_PASSWORD");
  await expect(
    ensureDatabase({
      driver: "mysql",
      runtimeUrl: "mysql://root@localhost/unsafe-name",
      production: false,
    }),
  ).rejects.toThrow("unsafe name");
});

test("migration execution selects dialect and closes its own connection on success and failure", async () => {
  directory = await mkdtemp(join(tmpdir(), "strata-migration-command-"));
  const options = { driver: "sqlite" as const, filename: join(directory, "nested/app.sqlite") };
  let retained: Parameters<Parameters<typeof withMigrationDatabase>[1]>[0] | undefined;
  expect(
    await withMigrationDatabase(options, async (db) => {
      retained = db;
      expect(currentSqlDialect().driver).toBe("sqlite");
      await db.unsafe("CREATE TABLE command_test (id INTEGER)");
      return 42;
    }),
  ).toBe(42);
  if (!retained) throw new Error("Migration callback did not run.");
  await expect(retained.unsafe("SELECT 1")).rejects.toThrow();
  const failure = new Error("migration failure");
  await expect(
    withMigrationDatabase(options, async (db) => {
      retained = db;
      throw failure;
    }),
  ).rejects.toBe(failure);
  if (!retained) throw new Error("Migration callback did not run.");
  await expect(retained.unsafe("SELECT 1")).rejects.toThrow();
});

test("SQLite filenames use the explicit application root while absolute and in-memory selections stay exact", () => {
  for (const DATABASE_URL of [
    "sqlite:./data/app.sqlite",
    "./data/app.sqlite",
    "sqlite://./data/app.sqlite",
  ]) {
    expect(
      resolveDatabaseOptions({ DATABASE_URL }, { driver: "sqlite", root: "/tmp/selected-app" }),
    ).toEqual({ driver: "sqlite", filename: "/tmp/selected-app/data/app.sqlite" });
  }
  for (const DATABASE_URL of [":memory:", "sqlite::memory:"]) {
    expect(
      resolveDatabaseOptions({ DATABASE_URL }, { driver: "sqlite", root: "/tmp/selected-app" }),
    ).toEqual({ driver: "sqlite", filename: ":memory:" });
  }
  for (const DATABASE_URL of [
    "/tmp/absolute.sqlite",
    "sqlite:/tmp/absolute.sqlite",
    "sqlite:///tmp/absolute.sqlite",
  ]) {
    expect(
      resolveDatabaseOptions({ DATABASE_URL }, { driver: "sqlite", root: "/tmp/selected-app" }),
    ).toEqual({ driver: "sqlite", filename: "/tmp/absolute.sqlite" });
  }
});

test("provisioning rejects malformed and missing database names before native connections", async () => {
  for (const runtimeUrl of [
    "not a URL",
    "mysql://root@localhost/",
    "mysql://root@localhost/unsafe-name",
  ]) {
    await expect(
      ensureDatabase({ driver: "mysql", runtimeUrl, production: false }),
    ).rejects.toThrow();
  }
  await expect(
    ensureDatabase({
      driver: "pgsql",
      runtimeUrl: "postgresql://app@localhost/unsafe-name",
      migrationUrl: "postgresql://admin@localhost/unused",
      password: "explicit-production-secret",
      production: true,
      provision: true,
    }),
  ).rejects.toThrow("unsafe");
});

test.skipIf(!process.env.MIGRATION_DATABASE_URL)(
  "owned PostgreSQL migration helpers grant runtime reads and close on success and failure",
  async () => {
    const { SQL } = await import("bun");
    const adminUrl = process.env.MIGRATION_DATABASE_URL ?? "";
    const control = new SQL(adminUrl);
    const name = `strata_command_${crypto.randomUUID().replaceAll("-", "")}`;
    const migration = new URL(adminUrl);
    migration.pathname = `/${name}`;
    const runtime = new URL(process.env.APP_DATABASE_URL ?? adminUrl);
    runtime.pathname = `/${name}`;
    let created = false;
    let retained: Parameters<Parameters<typeof withMigrationDatabase>[1]>[0] | undefined;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      expect(
        await withMigrationDatabase(
          { driver: "pgsql", url: runtime.href },
          async (db) => {
            retained = db;
            expect(currentSqlDialect().driver).toBe("pgsql");
            await db.unsafe("CREATE TABLE owned_command (id INTEGER)");
            await db.unsafe("INSERT INTO owned_command VALUES (7)");
            return 7;
          },
          { environment: { MIGRATION_DATABASE_URL: migration.href } },
        ),
      ).toBe(7);
      if (!retained) throw new Error("Migration callback did not run.");
      await expect(retained.unsafe("SELECT 1")).rejects.toThrow();
      const reader = new SQL(runtime.href);
      try {
        expect(await reader.unsafe("SELECT id FROM owned_command")).toEqual([{ id: 7 }]);
      } finally {
        await reader.close();
      }
      const failure = new Error("owned PostgreSQL migration failed");
      await expect(
        withMigrationDatabase(
          { driver: "pgsql", url: runtime.href },
          async (db) => {
            retained = db;
            throw failure;
          },
          {
            environment: { MIGRATION_DATABASE_URL: migration.href },
            grantRuntimePrivileges: false,
          },
        ),
      ).rejects.toBe(failure);
      await expect(retained.unsafe("SELECT 1")).rejects.toThrow();
    } finally {
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);

test.skipIf(!process.env.MYSQL_OBSERVABILITY_ADMIN_URL)(
  "owned MySQL provisioning and migration helpers close their native connections",
  async () => {
    const { createConnection } = await import("mysql2/promise");
    const adminUrl = process.env.MYSQL_OBSERVABILITY_ADMIN_URL ?? "";
    const control = await createConnection(adminUrl);
    const name = `strata_command_${crypto.randomUUID().replaceAll("-", "")}`;
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    let created = false;
    let retained: Parameters<Parameters<typeof withMigrationDatabase>[1]>[0] | undefined;
    try {
      expect(
        await ensureDatabase({
          driver: "mysql",
          runtimeUrl: url.href,
          migrationUrl: adminUrl,
          production: true,
          provision: true,
        }),
      ).toBe(url.href);
      created = true;
      expect(
        await withMigrationDatabase(
          { driver: "mysql", url: url.href },
          async (db) => {
            retained = db;
            expect(currentSqlDialect().driver).toBe("mysql");
            await db.unsafe("CREATE TABLE owned_command(id INTEGER)");
            await db.unsafe("INSERT INTO owned_command VALUES (7)");
            return 7;
          },
          { environment: { MIGRATION_DATABASE_URL: url.href } },
        ),
      ).toBe(7);
      if (!retained) throw new Error("Migration callback did not run.");
      await expect(retained.unsafe("SELECT 1")).rejects.toThrow();
      const failure = new Error("owned MySQL migration failed");
      await expect(
        withMigrationDatabase(
          { driver: "mysql", url: url.href },
          async (db) => {
            retained = db;
            throw failure;
          },
          { environment: {} },
        ),
      ).rejects.toBe(failure);
      await expect(retained.unsafe("SELECT 1")).rejects.toThrow();
      const [rows] = await control.query<import("mysql2/promise").RowDataPacket[]>(
        `SELECT id FROM ${name}.owned_command`,
      );
      expect(rows.map((row) => row.id)).toEqual([7]);
    } finally {
      if (created) await control.query(`DROP DATABASE ${name}`);
      await control.end();
    }
  },
);
