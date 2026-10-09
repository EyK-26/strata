import { expect, test } from "bun:test";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { dialectFor } from "@getstrata/core/database/dialect";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { SQL } from "bun";

for (const driver of ["pgsql", "sqlite", "mysql"] as const) {
  const enabled =
    driver === "sqlite" ||
    Boolean(driver === "pgsql" ? process.env.MIGRATION_DATABASE_URL : process.env.MYSQL_URL);
  (enabled ? test : test.skip)(
    `${driver}: bigId generates values beyond signed 32-bit range`,
    async () => {
      let db: DatabaseConnection;
      if (driver === "pgsql") {
        const pool = new SQL(process.env.MIGRATION_DATABASE_URL ?? "");
        db = {
          async unsafe<T>(text: string, params: readonly unknown[] = []) {
            return pool.unsafe<T[]>(text, [...params]);
          },
          close: () => pool.close(),
        };
      } else
        db =
          driver === "mysql"
            ? createMysqlConnection(process.env.MYSQL_URL ?? "")
            : createSqliteConnection(":memory:");
      const name = `big_id_${crypto.randomUUID().replaceAll("-", "")}`;
      const quote = dialectFor(driver).quoteIdentifier;
      const table = quote(name);
      try {
        await Schema.run(db, driver, (schema) => {
          schema.create(name, (columns) => {
            columns.bigId("order_id");
            columns.string("label");
          });
        });
        await db.unsafe(`INSERT INTO ${table} (label) VALUES ('first')`);
        expect(
          Number(
            (await db.unsafe<{ order_id: number | string }>(`SELECT order_id FROM ${table}`))[0]
              ?.order_id,
          ),
        ).toBe(1);
        if (driver === "pgsql")
          await db.unsafe("SELECT setval(pg_get_serial_sequence($1,'order_id'),2147483647)", [
            name,
          ]);
        else if (driver === "mysql")
          await db.unsafe(`ALTER TABLE ${table} AUTO_INCREMENT=2147483648`);
        else await db.unsafe("UPDATE sqlite_sequence SET seq=? WHERE name=?", [2147483647, name]);
        await db.unsafe(`INSERT INTO ${table} (label) VALUES ('second')`);
        const rows = await db.unsafe<{ order_id: number | string }>(
          `SELECT order_id FROM ${table} WHERE label='second'`,
        );
        expect(Number(rows[0]?.order_id)).toBe(2147483648);
        await expect(
          db.unsafe(`INSERT INTO ${table} (order_id,label) VALUES (2147483648,'duplicate')`),
        ).rejects.toThrow();
      } finally {
        try {
          await db.unsafe(`DROP TABLE IF EXISTS ${table}`);
        } finally {
          await db.close?.();
        }
      }
    },
  );
}
