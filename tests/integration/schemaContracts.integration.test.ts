import { expect, test } from "bun:test";
import { strict as assert } from "node:assert";
import { Schema } from "@getstrata/core/database/schema";
import { SQL } from "bun";

const url = process.env.MIGRATION_DATABASE_URL;
const databaseTest = url ? test : test.skip;

databaseTest(
  "Postgres enforces builder constraints on create and populated alteration",
  async () => {
    if (!url) throw new Error("MIGRATION_DATABASE_URL is required.");
    const control = new SQL(url);
    const name = `schema_contract_${crypto.randomUUID().replaceAll("-", "")}`;
    let db: SQL | undefined;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      const target = new URL(url);
      target.pathname = `/${name}`;
      db = new SQL(target.href);
      await Schema.run(db, "pgsql", (schema) => {
        schema.create("orders", (table) => {
          table.integer("tenant_id");
          table.integer("id");
          table.unique(["tenant_id", "id"], "order_identity");
        });
        schema.create("payments", (table) => {
          table.text("id").primary();
          table.integer("tenant_id");
          table.integer("order_id");
          table.string("note", 500);
          table.text("provider_key");
          table.unique("provider_key", "provider_identity");
          table.foreignKey(["tenant_id", "order_id"], "orders", ["tenant_id", "id"], {
            name: "payment_binding",
          });
          table.check("order_id > 0 AND tenant_id > 0", "positive_identity");
        });
      });
      await db.unsafe("INSERT INTO orders VALUES (1,1),(2,2)");
      const connection = db;
      const insert = (id: string, tenant: number, order: number, note: string, key: string) =>
        connection.unsafe("INSERT INTO payments VALUES ($1,$2,$3,$4,$5)", [
          id,
          tenant,
          order,
          note,
          key,
        ]);
      await insert("good", 1, 1, "x".repeat(500), "key");
      await assert.rejects(
        async () => await insert("long", 1, 1, "x".repeat(501), "other"),
        /too long/,
      );
      await assert.rejects(
        async () => await insert("cross", 2, 1, "valid", "other"),
        /payment_binding/,
      );
      await assert.rejects(
        async () => await insert("duplicate", 1, 1, "valid", "key"),
        /provider_identity/,
      );
      await db.unsafe("INSERT INTO orders VALUES (0,0)");
      await assert.rejects(
        async () => await insert("invalid", 0, 0, "valid", "other"),
        /positive_identity/,
      );
      await Schema.run(db, "pgsql", (schema) => {
        schema.table("payments", (table) => {
          table.timestamp("paid_at").nullable();
          table.text("intent").nullable().unique();
          table.check("(paid_at IS NULL) = (intent IS NULL)", "verified_identity");
        });
      });
      await assert.rejects(
        async () => await connection.unsafe("UPDATE payments SET paid_at=NOW()"),
        /verified_identity/,
      );
      await db.unsafe("UPDATE payments SET paid_at=NOW(),intent='pi_fixture'");
      expect((await db.unsafe("SELECT count(*)::int AS n FROM payments"))[0].n).toBe(1);
    } finally {
      await db?.close();
      await control.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);

// Exercise the same public compiler with real SQLite and MySQL parsers.
import { Database } from "bun:sqlite";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";
import { createPool } from "mysql2/promise";

async function createBindings(db: MigrationDatabase, driver: "mysql" | "sqlite", prefix = "") {
  await Schema.run(db, driver, (schema) => {
    schema.create(`${prefix}parent`, (table) => {
      table.integer("tenant_id");
      table.integer("id");
      table.unique(["tenant_id", "id"], `${prefix}parent_identity`);
    });
    schema.create(`${prefix}child`, (table) => {
      table.integer("tenant_id");
      table.integer("parent_id");
      table.string("provider_key", 100);
      table.unique("provider_key", `${prefix}child_identity`);
      table.foreignKey(["tenant_id", "parent_id"], `${prefix}parent`, ["tenant_id", "id"]);
      table.check("tenant_id > 0", `${prefix}positive_tenant`);
      table.index("parent_id", { name: `${prefix}child_lookup` });
    });
  });
}

test("SQLite enforces generated composite bindings, uniqueness and checks", async () => {
  const sqlite = new Database(":memory:");
  const db: MigrationDatabase = {
    async unsafe<T>(query: string, params: unknown[] = []) {
      return sqlite.query(query).all(...(params as Array<string | number>)) as T[];
    },
  };
  try {
    sqlite.exec("PRAGMA foreign_keys=ON");
    await createBindings(db, "sqlite");
    await db.unsafe("INSERT INTO parent VALUES (1,1),(2,2),(0,0)");
    await db.unsafe("INSERT INTO child VALUES (1,1,'key')");
    await assert.rejects(() => db.unsafe("INSERT INTO child VALUES (2,1,'other')"), /FOREIGN KEY/);
    await assert.rejects(() => db.unsafe("INSERT INTO child VALUES (1,1,'key')"), /UNIQUE/);
    await assert.rejects(() => db.unsafe("INSERT INTO child VALUES (0,0,'other')"), /CHECK/);
    await assert.rejects(
      () =>
        Schema.run(db, "sqlite", (schema) => {
          schema.table("child", (table) => {
            table.text("must_not_be_added");
            table.check("parent_id > 0");
          });
        }),
      /not supported/,
    );
    expect(sqlite.query("PRAGMA table_info(child)").all().length).toBe(3);
  } finally {
    sqlite.close();
  }
});

const mysqlUrl = process.env.MYSQL_URL;
(mysqlUrl ? test : test.skip)(
  "MySQL executes builder create, indexes and populated constraints",
  async () => {
    if (!mysqlUrl) throw new Error("MYSQL_URL is required.");
    const pool = createPool(mysqlUrl);
    const connection = await pool.getConnection();
    const prefix = `sc_${crypto.randomUUID().replaceAll("-", "")}_`;
    const parent = `${prefix}parent`,
      child = `${prefix}child`;
    const db: MigrationDatabase = {
      async unsafe<T>(query: string, params: unknown[] = []) {
        const [rows] = await connection.query(query, params);
        return rows as T[];
      },
    };
    try {
      await createBindings(db, "mysql", prefix);
      await db.unsafe(`INSERT INTO ${parent} VALUES (1,1),(2,2),(0,0)`);
      await db.unsafe(`INSERT INTO ${child} VALUES (1,1,'key')`);
      await assert.rejects(
        () => db.unsafe(`INSERT INTO ${child} VALUES (2,1,'other')`),
        /foreign key/i,
      );
      await assert.rejects(
        () => db.unsafe(`INSERT INTO ${child} VALUES (1,1,'key')`),
        /Duplicate entry/,
      );
      await assert.rejects(
        () => db.unsafe(`INSERT INTO ${child} VALUES (0,0,'other')`),
        /check constraint/i,
      );
      await Schema.run(db, "mysql", (schema) => {
        schema.table(child, (table) => {
          table.check("parent_id > 0", `${prefix}positive_parent`);
          table.dropIndex(`${prefix}child_lookup`);
        });
      });
      expect((await db.unsafe<{ n: number }>(`SELECT COUNT(*) AS n FROM ${child}`))[0]?.n).toBe(1);
    } finally {
      try {
        await connection.query(`DROP TABLE IF EXISTS ${child}`);
        await connection.query(`DROP TABLE IF EXISTS ${parent}`);
      } finally {
        connection.release();
        await pool.end();
      }
    }
  },
);
