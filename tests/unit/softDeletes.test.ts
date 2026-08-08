import { describe, expect, test } from "bun:test";
import {
  BaseRepository,
  buildSelectQuery,
  defineTable,
  type DatabaseConnection,
} from "../../src/core/database";
import { eventBus } from "../../src/core/events";

type SoftRecord = {
  id: number;
  name: string;
  deleted_at: Date | null;
};

const softTable = defineTable<SoftRecord, "id">({
  name: "soft_item",
  primaryKey: "id",
  columns: ["id", "name", "deleted_at"],
  softDeletes: true,
  defaultOrderBy: { column: "id", direction: "ASC" },
});

class FakeConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(
    query: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    this.calls.push({ query, params: [...params] });
    return (this.responses.shift() ?? []) as T[];
  }
}

class SoftRepository extends BaseRepository<SoftRecord, "id"> {
  constructor(connection: DatabaseConnection) {
    super(softTable, connection);
  }
}

describe("soft delete query scoping", () => {
  test("excludes trashed rows by default", () => {
    const { text } = buildSelectQuery(softTable);

    expect(text).toContain('"soft_item"."deleted_at" IS NULL');
  });

  test("includes trashed rows when withTrashed is enabled", () => {
    const { text } = buildSelectQuery(softTable, { withTrashed: true });

    expect(text).not.toContain('"soft_item"."deleted_at" IS NULL');
  });

  test("returns only trashed rows when onlyTrashed is enabled", () => {
    const { text } = buildSelectQuery(softTable, { onlyTrashed: true });

    expect(text).toContain('"soft_item"."deleted_at" IS NOT NULL');
  });
});

describe("soft delete repository", () => {
  test("soft deletes by setting deleted_at instead of removing the row", async () => {
    const connection = new FakeConnection();
    const repository = new SoftRepository(connection);
    const deletedAt = new Date("2026-01-01T00:00:00.000Z");

    connection.queue([
      {
        id: 1,
        name: "Alpha",
        deleted_at: deletedAt,
      },
    ]);

    const result = await repository.deleteById(1);

    expect(result).toBe(true);
    expect(connection.calls[0]?.query).toContain("UPDATE");
    expect(connection.calls[0]?.query).toContain('"deleted_at"');
    expect(connection.calls[0]?.params[1]).toBe(1);
  });

  test("restores a soft deleted row", async () => {
    const connection = new FakeConnection();
    const repository = new SoftRepository(connection);

    connection.queue([
      {
        id: 1,
        name: "Alpha",
        deleted_at: null,
      },
    ]);

    const record = await repository.restoreById(1);

    expect(record?.deleted_at).toBeNull();
    expect(connection.calls[0]?.query).toContain('"deleted_at" = $1');
    expect(connection.calls[0]?.params).toEqual([null, 1]);
  });

  test("force deletes a row permanently", async () => {
    const connection = new FakeConnection();
    const repository = new SoftRepository(connection);

    connection.queue([{ deleted_id: 1 }]);

    expect(await repository.forceDeleteById(1)).toBe(true);
    expect(connection.calls[0]?.query).toContain("DELETE FROM");
  });

  test("dispatches model events for repository writes", async () => {
    const connection = new FakeConnection();
    const repository = new SoftRepository(connection);
    const events: string[] = [];

    const unsubscribe = eventBus.listen("soft_item.created", () => {
      events.push("created");
    });

    connection.queue([
      {
        id: 1,
        name: "Alpha",
        deleted_at: null,
      },
    ]);

    await repository.create({
      id: 1,
      name: "Alpha",
      deleted_at: null,
    });

    unsubscribe();
    expect(events).toEqual(["created"]);
  });
});
