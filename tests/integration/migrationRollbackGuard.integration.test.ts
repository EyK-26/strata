import { expect, test } from "bun:test";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  freshDatabase,
  guardMigrationRollback,
  migrateDatabase,
  rollbackDatabase,
} from "@getstrata/core/database/migrations/runner";
import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema } from "@getstrata/core/database/schema";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

test("guarded application history survives rollback and legacy reset; explicit reset reapplies", async () => {
  const db = createSqliteConnection(":memory:");
  let reads = 0;
  const migration: Migration = {
    name: "application_history",
    async up(connection) {
      await Schema.run(connection, "sqlite", (schema) => {
        schema.create("application_history", (table) => {
          table.id();
          table.text("note");
        });
      });
    },
    async down(connection, context) {
      await guardMigrationRollback(context, {
        async hasHistory() {
          reads++;
          return (await connection.unsafe("SELECT id FROM application_history LIMIT 1")).length > 0;
        },
        message: "Retain application audit history",
      });
      await Schema.run(connection, "sqlite", (schema) => {
        schema.drop("application_history");
      });
    },
  };
  try {
    useSqlDialect("sqlite");
    await migrateDatabase(db, [migration]);
    // Empty history still permits an ordinary rollback.
    await rollbackDatabase(db, [migration]);
    await migrateDatabase(db, [migration]);
    await db.unsafe("INSERT INTO application_history (note) VALUES (?)", ["Retained effect"]);
    await expect(rollbackDatabase(db, [migration])).rejects.toThrow(
      "Retain application audit history",
    );
    await expect(freshDatabase(db, [migration])).rejects.toThrow(
      "Retain application audit history",
    );
    expect(await db.unsafe("SELECT note FROM application_history")).toEqual([
      { note: "Retained effect" },
    ]);
    expect((await db.unsafe("SELECT name FROM framework_migrations")).length).toBe(1);
    const beforeFresh = reads;
    await freshDatabase(db, [migration], { destructive: true });
    await freshDatabase(db, [migration], { destructive: true });
    expect(reads).toBe(beforeFresh);
    expect(await db.unsafe("SELECT note FROM application_history")).toEqual([]);
    expect((await db.unsafe("SELECT name FROM framework_migrations")).length).toBe(1);
  } finally {
    db.close();
    resetSqlDialect();
  }
});
