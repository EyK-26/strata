import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  ).toEqual({ driver: "sqlite", filename: "./storage/app.sqlite" });
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
