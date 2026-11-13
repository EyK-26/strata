import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountStateMigration } from "@getstrata/core/auth/accountStateMigration";
import { revokeUserSessions } from "@getstrata/core/auth/oneTimeToken";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import type { DatabaseDriver } from "@getstrata/core/database/schema/driver";
import { SQL } from "bun";
import { createConnection } from "mysql2/promise";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";

async function qualify(
  db: MigrationDatabase,
  driver: DatabaseDriver,
  owner: Awaited<ReturnType<typeof createNativePersistenceApplication>>,
) {
  await Schema.run(db, driver, (schema) => {
    schema.create("users", (table) => {
      table.integer("id").primary();
      table.text("name");
      table.text("session_valid_after").nullable();
    });
    for (const name of ["sessions", "api_tokens"]) {
      schema.create(name, (table) => {
        table.integer("id").primary();
        table.integer("user_id");
      });
    }
  });
  await db.unsafe("INSERT INTO users (id,name) VALUES (1,'existing')");
  const migration = createAccountStateMigration("account_state", driver, { sessions: true });
  expect(migration.name).toBe("account_state");
  await migration.up(db);
  await db.unsafe("INSERT INTO users (id,name) VALUES (2,'old writer')");
  const read = () =>
    db.unsafe<{ id: number; is_active: boolean | number; auth_version: number }>(
      "SELECT id,is_active,auth_version FROM users ORDER BY id",
    );
  expect((await read()).map((row) => [row.id, Boolean(row.is_active), row.auth_version])).toEqual([
    [1, true, 0],
    [2, true, 0],
  ]);
  await expect(
    (async () => {
      await db.unsafe("UPDATE users SET auth_version=-1 WHERE id=1");
    })(),
  ).rejects.toThrow();
  await expect(
    (async () => {
      await db.unsafe("UPDATE users SET auth_version=NULL WHERE id=1");
    })(),
  ).rejects.toThrow();
  await expect(
    (async () => {
      await db.unsafe("UPDATE users SET is_active=NULL WHERE id=1");
    })(),
  ).rejects.toThrow();
  // Ordinary rollback must not silently reactivate suspended accounts or revive proofs.
  await expect(migration.down(db)).rejects.toThrow("administrative");
  await db.unsafe("UPDATE users SET is_active=FALSE WHERE id=1");
  for (const table of ["sessions", "api_tokens"]) {
    await db.unsafe(`INSERT INTO ${table} (id,user_id) VALUES (1,1),(2,2)`);
  }
  await owner.run(async (database) => {
    await revokeUserSessions(database, 1, { incrementAuthVersion: true });
    await revokeUserSessions(database, 1, { incrementAuthVersion: true });
  });
  expect((await read()).map((row) => [row.id, Boolean(row.is_active), row.auth_version])).toEqual([
    [1, false, 2],
    [2, true, 0],
  ]);
  for (const table of ["sessions", "api_tokens"]) {
    expect(await db.unsafe(`SELECT user_id FROM ${table}`)).toEqual([{ user_id: 2 }]);
  }
  // Failure after epoch/session mutation must roll back together with account status.
  await db.unsafe("INSERT INTO sessions (id,user_id) VALUES (3,1)");
  try {
    await owner.run((database) =>
      database.transaction(async (child) => {
        await child.execute({ text: "UPDATE users SET is_active=TRUE WHERE id=1", params: [] });
        await revokeUserSessions(child, 1, { incrementAuthVersion: true });
        await child.execute({ text: "INSERT INTO sessions (id,user_id) VALUES (2,1)", params: [] });
        throw new Error("Expected duplicate primary key failure");
      }),
    );
  } catch (error) {
    const native = error && typeof error === "object" && "cause" in error ? error.cause : error;
    expect(String(native)).not.toContain("Expected duplicate");
    expect(String(native)).toMatch(/duplicate|unique/i);
  }
  expect((await read())[0]?.auth_version).toBe(2);
  expect(Boolean((await read())[0]?.is_active)).toBe(false);
  expect(await db.unsafe("SELECT user_id FROM sessions WHERE id=3")).toEqual([{ user_id: 1 }]);
  // A cookie-only installation has no API-token table. Missing optional storage
  // must not silently abort the surrounding Postgres account transaction.
  await db.unsafe("DROP TABLE api_tokens");
  await owner.run((database) =>
    database.transaction((child) => revokeUserSessions(child, 1, { incrementAuthVersion: true })),
  );
  expect((await read())[0]?.auth_version).toBe(3);
  expect(await db.unsafe("SELECT user_id FROM sessions WHERE id=3")).toEqual([]);
  await db.unsafe("DROP TABLE sessions");
  await owner.run((database) =>
    database.transaction((child) => revokeUserSessions(child, 1, { incrementAuthVersion: true })),
  );
  expect((await read())[0]?.auth_version).toBe(4);
  await Schema.run(db, driver, (schema) => {
    schema.create("sessions", (table) => {
      table.integer("id").primary();
      table.integer("auth_version").default(0);
    });
  });
  await expect(migration.down(db)).rejects.toThrow("administrative");
  await migration.down(db, { operation: "fresh" });
  const rows = await db.unsafe<Record<string, unknown>>("SELECT * FROM users ORDER BY id");
  expect(rows.map((row) => row.name)).toEqual(["existing", "old writer"]);
  expect(Object.hasOwn(rows[0] ?? {}, "is_active")).toBe(false);
  expect(Object.hasOwn(rows[0] ?? {}, "auth_version")).toBe(false);
}

test("account-state additive migration and transactional revocation on SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "account-state-native-"));
  const filename = join(directory, "app.sqlite");
  const sqlite = new Database(filename);
  const owner = await createNativePersistenceApplication({
    default: "main",
    connections: { main: { driver: "sqlite", filename } },
  });
  const db: MigrationDatabase = {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      return sqlite.query(query).all(...(params as (string | number | null)[])) as T[];
    },
  };
  try {
    await qualify(db, "sqlite", owner);
  } finally {
    await owner.close();
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("account-state additive migration and transactional revocation on Postgres", async () => {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL required; run with scripts/with-host-env.sh");
  const control = new SQL(url);
  const name = `account_state_${crypto.randomUUID().replaceAll("-", "")}`;
  let connection: SQL | undefined;
  let close = async () => {};
  try {
    await control.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url);
    target.pathname = `/${name}`;
    connection = new SQL(target.href, { max: 1 });
    const owner = await createNativePersistenceApplication({
      default: "main",
      connections: { main: { driver: "pgsql", url: target.href, max: 1 } },
    });
    close = owner.close;
    await qualify(connection, "pgsql", owner);
  } finally {
    await close();
    await connection?.close();
    await control.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await control.close();
  }
});

test("account-state additive migration and transactional revocation on MySQL", async () => {
  const url = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  if (!url)
    throw new Error("MYSQL_OBSERVABILITY_ADMIN_URL required; run with scripts/with-host-env.sh");
  const connection = await createConnection(url);
  const name = `account_state_${crypto.randomUUID().replaceAll("-", "")}`;
  let close = async () => {};
  const db: MigrationDatabase = {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      const [rows] = await connection.query(query, [...params]);
      return rows as T[];
    },
  };
  try {
    await connection.query(`CREATE DATABASE ${name}`);
    await connection.query(`USE ${name}`);
    const target = new URL(url);
    target.pathname = `/${name}`;
    const owner = await createNativePersistenceApplication({
      default: "main",
      connections: { main: { driver: "mysql", url: target.href, max: 1 } },
    });
    close = owner.close;
    await qualify(db, "mysql", owner);
  } finally {
    await close();
    await connection.query(`DROP DATABASE IF EXISTS ${name}`);
    await connection.end();
  }
});

test("account-state migration defaults do not require cookie storage", async () => {
  const sqlite = new Database(":memory:");
  const db: MigrationDatabase = {
    async unsafe<T>(query: string) {
      return sqlite.query(query).all() as T[];
    },
  };
  try {
    await db.unsafe("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    const migration = createAccountStateMigration("users_only", "sqlite");
    await migration.up(db);
    await db.unsafe("INSERT INTO users (id) VALUES (1)");
    expect(await db.unsafe("SELECT is_active,auth_version FROM users")).toEqual([
      { is_active: 1, auth_version: 0 },
    ]);
    await migration.down(db, { operation: "fresh" });
  } finally {
    sqlite.close();
  }
});
