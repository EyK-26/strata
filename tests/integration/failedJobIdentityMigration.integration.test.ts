import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { SQL } from "bun";
import { createPool } from "mysql2/promise";
import migration from "../../apps/hiroapp/src/db/migrations/0002_add_failed_job_identity";
import fixtureMigration from "../../src/db/migrations/0038_add_failed_job_identity";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function upgrade(db: MigrationDatabase, driver: "pgsql" | "mysql" | "sqlite") {
  const previous = process.env.DB_CONNECTION;
  process.env.DB_CONNECTION = driver;
  try {
    await Schema.run(db, driver, (schema) => {
      schema.create("failed_job", (table) => {
        table.integer("id").primary();
        table.text("payload");
      });
    });
    await db.unsafe("INSERT INTO failed_job (id,payload) VALUES (1,'old payload')");
    await migration.up(db);
    expect(await db.unsafe("SELECT id,payload,job_id FROM failed_job WHERE id=1")).toEqual([
      { id: 1, payload: "old payload", job_id: null },
    ]);
    // An old writer still omits the new nullable column while a new writer stores it.
    await db.unsafe("INSERT INTO failed_job (id,payload) VALUES (2,'old writer')");
    await db.unsafe("UPDATE failed_job SET job_id='stored-identity' WHERE id=1");
    expect(await db.unsafe("SELECT job_id FROM failed_job ORDER BY id")).toEqual([
      { job_id: "stored-identity" },
      { job_id: null },
    ]);
    await migration.down(db);
    // Verify removal through returned row shape, without a lazy driver query assertion.
    expect(await db.unsafe("SELECT * FROM failed_job ORDER BY id")).toEqual([
      { id: 1, payload: "old payload" },
      { id: 2, payload: "old writer" },
    ]);
    expect(await db.unsafe("SELECT id,payload FROM failed_job ORDER BY id")).toEqual([
      { id: 1, payload: "old payload" },
      { id: 2, payload: "old writer" },
    ]);
  } finally {
    restoreEnvVar("DB_CONNECTION", previous);
  }
}

test("failed-job identity upgrade preserves populated SQLite recovery tables", async () => {
  const sqlite = new Database(":memory:");
  const db: MigrationDatabase = {
    async unsafe<T>(query: string) {
      return sqlite.query(query).all() as T[];
    },
  };
  try {
    await upgrade(db, "sqlite");
  } finally {
    sqlite.close();
  }
});

test.skipIf(!process.env.MIGRATION_DATABASE_URL)(
  "failed-job identity upgrade preserves populated Postgres recovery tables",
  async () => {
    const url = process.env.MIGRATION_DATABASE_URL;
    if (!url) throw new Error("Missing test database URL");
    const control = new SQL(url);
    const name = `failed_identity_${crypto.randomUUID().replaceAll("-", "")}`;
    let db: SQL | undefined;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      const target = new URL(url);
      target.pathname = `/${name}`;
      db = new SQL(target.href);
      await upgrade(db, "pgsql");
      await fixtureMigration.up(db);
      expect(
        await db.unsafe<{ job_id: string | null }[]>("SELECT job_id FROM failed_job ORDER BY id"),
      ).toEqual([{ job_id: null }, { job_id: null }]);
      await fixtureMigration.down(db);
      expect(
        await db.unsafe<{ id: number; payload: string }[]>("SELECT * FROM failed_job ORDER BY id"),
      ).toEqual([
        { id: 1, payload: "old payload" },
        { id: 2, payload: "old writer" },
      ]);
    } finally {
      await db?.close();
      await control.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);

test.skipIf(!process.env.MYSQL_URL)(
  "failed-job identity upgrade preserves populated MySQL recovery tables",
  async () => {
    const url = process.env.MYSQL_URL;
    if (!url) throw new Error("Missing test database URL");
    const pool = createPool(url);
    const name = `failed_identity_${crypto.randomUUID().replaceAll("-", "")}`;
    const db: MigrationDatabase = {
      async unsafe<T>(query: string) {
        // Isolate the migration's fixed table in the dedicated shared MySQL fixture.
        const [rows] = await pool.query(query.replaceAll("failed_job", name));
        return rows as T[];
      },
    };
    try {
      await upgrade(db, "mysql");
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${name}`);
      await pool.end();
    }
  },
);
