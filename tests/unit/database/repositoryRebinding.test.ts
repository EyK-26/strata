import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { eventBus } from "@getstrata/core/events";

type RecordRow = { id: number; scope: string };
const table = defineTable<RecordRow, "id">({
  name: "rebinding_records",
  primaryKey: "id",
  columns: ["id", "scope"],
});

class RecordingConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  constructor(private readonly row: RecordRow) {}

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params });
    return [this.row] as T[];
  }
}

class LegacyRepository extends BaseRepository<RecordRow, "id"> {
  readonly label = "records";
  constructor(connection: DatabaseConnection) {
    super(table, connection);
  }

  labelFromInheritedMethod() {
    return this.label;
  }
}

class ScopedRepository extends BaseRepository<RecordRow, "id"> {
  readonly #scope: string;

  constructor(connection: DatabaseConnection, scope: string) {
    super(table, connection);
    this.#scope = scope;
  }

  protected override cloneWithConnection(connection: DatabaseConnection): this {
    return new ScopedRepository(connection, this.#scope) as this;
  }

  findScoped() {
    return this.findWhere({ scope: this.#scope });
  }
}

describe("repository connection rebinding", () => {
  test("keeps the default prototype and own-state behavior without mutating the original", async () => {
    const originalConnection = new RecordingConnection({ id: 1, scope: "original" });
    const reboundConnection = new RecordingConnection({ id: 2, scope: "rebound" });
    const original = new LegacyRepository(originalConnection);
    const rebound = original.withConnection(reboundConnection);

    expect(rebound).toBeInstanceOf(LegacyRepository);
    expect(rebound).not.toBe(original);
    expect(rebound.labelFromInheritedMethod()).toBe("records");
    expect(rebound.getTable()).toBe(original.getTable());
    expect(rebound.getConnection()).toBe(reboundConnection);
    expect(original.getConnection()).toBe(originalConnection);
    expect(await rebound.findById(2)).toEqual({ id: 2, scope: "rebound" });
    expect(originalConnection.calls).toHaveLength(0);
    expect(reboundConnection.calls).toHaveLength(1);
  });

  test("uses the protected clone hook to preserve native private state across independent bindings", async () => {
    const originalConnection = new RecordingConnection({ id: 1, scope: "tenant" });
    const firstConnection = new RecordingConnection({ id: 2, scope: "tenant" });
    const secondConnection = new RecordingConnection({ id: 3, scope: "tenant" });
    const original = new ScopedRepository(originalConnection, "tenant");
    const first = original.withConnection(firstConnection);
    const second = original.withConnection(secondConnection);

    expect(first).toBeInstanceOf(ScopedRepository);
    expect(second).not.toBe(first);
    const rows = await Promise.all([
      first.findScoped(),
      second.findScoped(),
      original.findScoped(),
    ]);
    expect(rows.map((result) => result[0]?.id)).toEqual([2, 3, 1]);
    for (const connection of [originalConnection, firstConnection, secondConnection]) {
      expect(connection.calls).toHaveLength(1);
      expect(connection.calls[0]?.params).toEqual(["tenant"]);
    }
    expect(original.getConnection()).toBe(originalConnection);
    expect(first.getConnection()).toBe(firstConnection);
    expect(second.getConnection()).toBe(secondConnection);
  });
});

test("private-state repository rebinding preserves transaction rollback and deferred events", async () => {
  const connection = createSqliteConnection(":memory:");
  const received: unknown[] = [];
  const stop = eventBus.listen("rebinding_records.created", (row) => {
    received.push(row);
  });
  useSqlDialect("sqlite");
  try {
    await connection.unsafe(
      "CREATE TABLE rebinding_records(id INTEGER PRIMARY KEY, scope TEXT NOT NULL)",
    );
    const original = new ScopedRepository(connection, "tenant");
    await expect(
      runInTransaction(
        async (transaction) => {
          const bound = original.withConnection(transaction);
          await bound.create({ id: 1, scope: "tenant" });
          expect((await bound.findScoped()).map((row) => row.id)).toEqual([1]);
          expect(received).toEqual([]);
          throw new Error("Roll back rebound repository write");
        },
        { connection },
      ),
    ).rejects.toThrow("Roll back rebound repository write");
    expect(await original.findScoped()).toEqual([]);
    expect(received).toEqual([]);
    await runInTransaction(
      async (transaction) => {
        await original.withConnection(transaction).create({ id: 2, scope: "tenant" });
        expect(received).toEqual([]);
      },
      { connection },
    );
    expect(received).toEqual([{ id: 2, scope: "tenant" }]);
    expect((await original.findScoped()).map((row) => row.id)).toEqual([2]);
    expect(original.getConnection()).toBe(connection);
  } finally {
    stop();
    resetSqlDialect();
    connection.close();
  }
});
