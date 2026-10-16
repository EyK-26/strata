import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createAccountStateMigration } from "@getstrata/core/auth/accountStateMigration";
import { revokeUserSessions } from "@getstrata/core/auth/oneTimeToken";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import type { DatabaseDriver } from "@getstrata/core/database/schema/driver";
import { SQL } from "bun";
import { createConnection } from "mysql2/promise";

async function qualify(db: MigrationDatabase, driver: DatabaseDriver) {
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
  const migration = createAccountStateMigration("account_state", driver);
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
  await runWithSqlDialect(driver, async () => {
    await revokeUserSessions(db, 1, { incrementAuthVersion: true });
    await revokeUserSessions(db, 1, { incrementAuthVersion: true });
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
  await db.unsafe("BEGIN");
  try {
    await db.unsafe("UPDATE users SET is_active=TRUE WHERE id=1");
    await runWithSqlDialect(driver, () =>
      revokeUserSessions(db, 1, { incrementAuthVersion: true }),
    );
    await db.unsafe("INSERT INTO sessions (id,user_id) VALUES (2,1)");
    throw new Error("Expected duplicate primary key failure");
  } catch (error) {
    expect(String(error)).not.toContain("Expected duplicate");
    expect(String(error)).toMatch(/duplicate|unique/i);
    await db.unsafe("ROLLBACK");
  }
  expect((await read())[0]?.auth_version).toBe(2);
  expect(Boolean((await read())[0]?.is_active)).toBe(false);
  expect(await db.unsafe("SELECT user_id FROM sessions WHERE id=3")).toEqual([{ user_id: 1 }]);
  // A cookie-only installation has no API-token table. Missing optional storage
  // must not silently abort the surrounding Postgres account transaction.
  await db.unsafe("DROP TABLE api_tokens");
  await db.unsafe("BEGIN");
  try {
    await runWithSqlDialect(driver, () =>
      revokeUserSessions(db, 1, { incrementAuthVersion: true }),
    );
    await db.unsafe("COMMIT");
  } catch (error) {
    await db.unsafe("ROLLBACK");
    throw error;
  }
  expect((await read())[0]?.auth_version).toBe(3);
  expect(await db.unsafe("SELECT user_id FROM sessions WHERE id=3")).toEqual([]);
  await db.unsafe("DROP TABLE sessions");
  await db.unsafe("BEGIN");
  try {
    await runWithSqlDialect(driver, () =>
      revokeUserSessions(db, 1, { incrementAuthVersion: true }),
    );
    await db.unsafe("COMMIT");
  } catch (error) {
    await db.unsafe("ROLLBACK");
    throw error;
  }
  expect((await read())[0]?.auth_version).toBe(4);
  await expect(migration.down(db)).rejects.toThrow("administrative");
  await migration.down(db, { operation: "fresh" });
  const rows = await db.unsafe<Record<string, unknown>>("SELECT * FROM users ORDER BY id");
  expect(rows.map((row) => row.name)).toEqual(["existing", "old writer"]);
  expect(Object.hasOwn(rows[0] ?? {}, "is_active")).toBe(false);
  expect(Object.hasOwn(rows[0] ?? {}, "auth_version")).toBe(false);
}

test("account-state additive migration and transactional revocation on SQLite", async () => {
  const sqlite = new Database(":memory:");
  const db: MigrationDatabase = {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      return sqlite.query(query).all(...(params as (string | number | null)[])) as T[];
    },
  };
  try {
    await qualify(db, "sqlite");
  } finally {
    sqlite.close();
  }
});

test("account-state additive migration and transactional revocation on Postgres", async () => {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL required; run with scripts/with-host-env.sh");
  const control = new SQL(url);
  const name = `account_state_${crypto.randomUUID().replaceAll("-", "")}`;
  let connection: SQL | undefined;
  try {
    await control.unsafe(`CREATE DATABASE ${name}`);
    const target = new URL(url);
    target.pathname = `/${name}`;
    connection = new SQL(target.href, { max: 1 });
    await qualify(connection, "pgsql");
  } finally {
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
  const db: MigrationDatabase = {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      const [rows] = await connection.query(query, [...params]);
      return rows as T[];
    },
  };
  try {
    await connection.query(`CREATE DATABASE ${name}`);
    await connection.query(`USE ${name}`);
    await qualify(db, "mysql");
  } finally {
    await connection.query(`DROP DATABASE IF EXISTS ${name}`);
    await connection.end();
  }
});
