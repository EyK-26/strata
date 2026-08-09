import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  ensureMigrationsTable,
  freshDatabase,
  getAppliedMigrations,
  getMigrationStatus,
  loadMigrationsFromDirectory,
  migrateDatabase,
  rollbackDatabase,
} from "../../src/core/database/migrations/runner";
import type { Migration, MigrationDatabase } from "../../src/core/database/migrations/types";

function createMemoryDb() {
  const applied: { name: string; batch: number }[] = [];
  const tables = new Set<string>();

  const db: MigrationDatabase = {
    async unsafe<T = unknown>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      if (query.includes("CREATE TABLE IF NOT EXISTS framework_migrations")) {
        return [];
      }

      if (query.includes("SELECT name, batch")) {
        return applied.map(({ name, batch }) => ({ name, batch })) as unknown as T[];
      }

      if (query.startsWith("INSERT INTO framework_migrations")) {
        const name = String(params[0]);
        if (applied.some((row) => row.name === name)) {
          return [] as unknown as T[];
        }
        applied.push({ name, batch: Number(params[1]) });
        return [{ name }] as unknown as T[];
      }

      if (query.startsWith("DELETE FROM framework_migrations WHERE name")) {
        const name = String(params[0]);
        const index = applied.findIndex((row) => row.name === name);
        if (index >= 0) applied.splice(index, 1);
        return [];
      }

      if (query.includes("DELETE FROM framework_migrations")) {
        applied.length = 0;
        return [];
      }

      if (query.includes("CREATE TABLE IF NOT EXISTS widgets")) {
        tables.add("widgets");
        return [];
      }

      if (query.includes("DROP TABLE IF EXISTS widgets")) {
        tables.delete("widgets");
        return [];
      }

      return [];
    },
  };

  return { db, applied, tables };
}

const migrations: Migration[] = [
  {
    name: "0001_create_widgets",
    async up(db) {
      await db.unsafe("CREATE TABLE IF NOT EXISTS widgets (id INT)");
    },
    async down(db) {
      await db.unsafe("DROP TABLE IF EXISTS widgets");
    },
  },
  {
    name: "0002_add_widget_color",
    async up(db) {
      await db.unsafe("ALTER TABLE widgets ADD COLUMN color TEXT");
    },
    async down(db) {
      await db.unsafe("ALTER TABLE widgets DROP COLUMN color");
    },
  },
];

describe("migration runner", () => {
  test("migrateDatabase applies pending migrations in order", async () => {
    const { db, applied, tables } = createMemoryDb();
    const names: string[] = [];

    const count = await migrateDatabase(db, migrations, {
      onMigration: (name) => names.push(name),
    });
    expect(count).toBe(2);
    expect(applied).toHaveLength(2);
    expect(tables.has("widgets")).toBe(true);
    expect(names).toEqual(["0001_create_widgets", "0002_add_widget_color"]);
  });

  test("migrateDatabase returns zero when nothing is pending", async () => {
    const { db } = createMemoryDb();
    await migrateDatabase(db, migrations);
    expect(await migrateDatabase(db, migrations)).toBe(0);
  });

  test("rollbackDatabase returns zero when nothing has been applied", async () => {
    const { db } = createMemoryDb();
    expect(await rollbackDatabase(db, migrations)).toBe(0);
  });

  test("ensureMigrationsTable creates the tracking table", async () => {
    const { db } = createMemoryDb();
    await ensureMigrationsTable(db);
    expect(await getAppliedMigrations(db)).toEqual([]);
  });

  test("getMigrationStatus reports pending and applied migrations", async () => {
    const { db } = createMemoryDb();
    expect(await getMigrationStatus(db, migrations)).toEqual([
      { name: "0001_create_widgets", status: "pending", batch: null },
      { name: "0002_add_widget_color", status: "pending", batch: null },
    ]);

    await migrateDatabase(db, migrations);
    expect(await getMigrationStatus(db, migrations)).toEqual([
      { name: "0001_create_widgets", status: "up", batch: 1 },
      { name: "0002_add_widget_color", status: "up", batch: 1 },
    ]);
  });

  test("rollbackDatabase rolls back the latest batch", async () => {
    const { db, applied, tables } = createMemoryDb();
    await migrateDatabase(db, migrations);

    const rolledBack = await rollbackDatabase(db, migrations);
    expect(rolledBack).toBe(2);
    expect(applied).toHaveLength(0);
    expect(tables.has("widgets")).toBe(false);
  });

  test("freshDatabase resets and re-applies migrations", async () => {
    const { db, applied } = createMemoryDb();
    await migrateDatabase(db, migrations);
    await freshDatabase(db, migrations);
    expect(applied).toHaveLength(2);
  });

  test("migrateDatabase throws when migration record cannot be inserted", async () => {
    const applied: { name: string; batch: number }[] = [];
    const db: MigrationDatabase = {
      async unsafe<T>(query: string, _params: readonly unknown[] = []): Promise<T[]> {
        if (query.includes("CREATE TABLE IF NOT EXISTS framework_migrations")) {
          return [];
        }

        if (query.includes("SELECT name, batch")) {
          return applied.map(({ name, batch }) => ({ name, batch })) as unknown as T[];
        }

        if (query.startsWith("INSERT INTO framework_migrations")) {
          return [] as unknown as T[];
        }

        if (query.includes("CREATE TABLE IF NOT EXISTS widgets")) {
          return [];
        }

        return [];
      },
    };

    await expect(migrateDatabase(db, migrations)).rejects.toThrow(
      "Migration 0001_create_widgets was applied but not recorded.",
    );
  });

  test("loadMigrationsFromDirectory imports migration modules", async () => {
    const loaded = await loadMigrationsFromDirectory(
      join(import.meta.dir, "../../src/db/migrations"),
    );
    expect(loaded.length).toBeGreaterThan(20);
    expect(loaded[0]?.name).toMatch(/^0001_/);
  });
});
