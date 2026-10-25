import { expect, test } from "bun:test";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { getMigrationStatus, migrateDatabase } from "@getstrata/core/database/migrations/runner";
import type { Migration } from "@getstrata/core/database/migrations/types";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

test("migration status reports missing history without creating it", async () => {
  const db = createSqliteConnection(":memory:");
  useSqlDialect("sqlite");
  try {
    await expect(getMigrationStatus(db, [])).rejects.toThrow(/framework_migrations/);
    expect(
      await db.unsafe("SELECT name FROM sqlite_schema WHERE name='framework_migrations'"),
    ).toEqual([]);
  } finally {
    await db.close?.();
    resetSqlDialect();
  }
});
test("migration status reads existing history under SQLite query-only admission", async () => {
  const db = createSqliteConnection(":memory:");
  useSqlDialect("sqlite");
  let calls = 0;
  const first: Migration = {
    name: "001_existing",
    async up() {
      calls++;
    },
    async down() {
      throw new Error("Status must not roll back");
    },
  };
  const pending: Migration = {
    name: "002_pending",
    async up() {
      throw new Error("Status must not migrate");
    },
    async down() {
      throw new Error("Status must not roll back");
    },
  };
  try {
    expect(await migrateDatabase(db, [first])).toBe(1);
    await db.unsafe("PRAGMA query_only=ON");
    expect(await getMigrationStatus(db, [first, pending])).toEqual([
      { name: first.name, status: "up", batch: 1 },
      { name: pending.name, status: "pending", batch: null },
    ]);
    expect(calls).toBe(1);
  } finally {
    await db.close?.();
    resetSqlDialect();
  }
});
