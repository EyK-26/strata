import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import {
  buildIncrementQuery,
  buildSelectQuery,
  buildUpsertQuery,
} from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";

type Counter = {
  id: number;
  slug: string;
  hits: number;
};

const counterTable = defineTable<Counter, "id">({
  name: "counters",
  primaryKey: "id",
  columns: ["id", "slug", "hits"],
});

class FakeConnection implements DatabaseConnection {
  readonly calls: Array<{ query: string; params: readonly unknown[] }> = [];
  private readonly responses: unknown[][] = [];

  queue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ query, params: [...params] });
    return (this.responses.shift() ?? []) as T[];
  }
}

class CounterRepository extends BaseRepository<Counter, "id"> {
  constructor(connection: DatabaseConnection) {
    super(counterTable, connection);
  }
}

describe("upsert", () => {
  test("postgres and sqlite use ON CONFLICT DO UPDATE with excluded", () => {
    for (const driver of ["pgsql", "sqlite"] as const) {
      const { text } = runWithSqlDialect(driver, () =>
        buildUpsertQuery(counterTable, { slug: "a", hits: 1 }, ["slug"]),
      ) as unknown as { text: string };

      expect(text).toContain('ON CONFLICT ("slug") DO UPDATE SET');
      expect(text).toContain('"hits" = excluded."hits"');
    }
  });

  test("mysql uses ON DUPLICATE KEY UPDATE", () => {
    const { text } = runWithSqlDialect("mysql", () =>
      buildUpsertQuery(counterTable, { slug: "a", hits: 1 }, ["slug"]),
    ) as unknown as { text: string };

    expect(text).toContain("ON DUPLICATE KEY UPDATE");
    expect(text).toContain("`hits` = VALUES(`hits`)");
  });

  test("an empty update list becomes DO NOTHING", () => {
    const { text } = runWithSqlDialect("pgsql", () =>
      buildUpsertQuery(counterTable, { slug: "a" }, ["slug"], []),
    ) as unknown as { text: string };

    expect(text).toContain("DO NOTHING");
  });

  test("sqlite also uses DO NOTHING for an empty update list", () => {
    const { text } = runWithSqlDialect("sqlite", () =>
      buildUpsertQuery(counterTable, { slug: "a" }, ["slug"], []),
    ) as unknown as { text: string };

    expect(text).toContain('ON CONFLICT ("slug") DO NOTHING');
  });

  test("mysql anchors its no-op update on a real conflict column", () => {
    const { text } = runWithSqlDialect("mysql", () =>
      buildUpsertQuery(counterTable, { slug: "a" }, ["slug"], []),
    ) as unknown as { text: string };

    expect(text).toContain("ON DUPLICATE KEY UPDATE `slug` = `slug`");
    expect(text).not.toContain("`id`");
  });

  test("conflict columns are excluded from the update set by default", () => {
    const { text } = runWithSqlDialect("pgsql", () =>
      buildUpsertQuery(counterTable, { slug: "a", hits: 1 }, ["slug"]),
    ) as unknown as { text: string };

    expect(text).not.toContain('"slug" = excluded."slug"');
  });

  test("values are bound, never inlined", () => {
    const { params } = runWithSqlDialect("pgsql", () =>
      buildUpsertQuery(counterTable, { slug: "a", hits: 1 }, ["slug"]),
    ) as unknown as { params: unknown[] };

    expect(params).toEqual(["a", 1]);
  });

  test("no values or no conflict columns is an error", () => {
    runWithSqlDialect("pgsql", () => {
      expect(() => buildUpsertQuery(counterTable, {}, ["slug"])).toThrow(/without any column/);
      expect(() => buildUpsertQuery(counterTable, { slug: "a" }, [])).toThrow(
        /without any conflict/,
      );
    });
  });

  test("the repository returns null when a DO NOTHING upsert changes nothing", async () => {
    const connection = new FakeConnection();
    const repository = new CounterRepository(connection);
    connection.queue([]);

    const result = await runWithSqlDialect("pgsql", async () =>
      repository.upsert({ slug: "a" }, ["slug"], []),
    );

    expect(result).toBeNull();
  });
});

describe("increment and decrement", () => {
  test("increment emits a self-referential assignment", () => {
    const { text, params } = runWithSqlDialect("pgsql", () =>
      buildIncrementQuery(counterTable, 1, "hits", 5),
    ) as unknown as { text: string; params: unknown[] };

    expect(text).toContain('"hits" = "hits" + $1');
    expect(params).toEqual([5, 1]);
  });

  test("extra columns are set alongside the counter", () => {
    const { text } = runWithSqlDialect("pgsql", () =>
      buildIncrementQuery(counterTable, 1, "hits", 1, { slug: "b" } as never),
    ) as unknown as { text: string };

    expect(text).toContain('"slug" = $2');
  });

  test("decrement passes a negative amount", async () => {
    const connection = new FakeConnection();
    const repository = new CounterRepository(connection);
    connection.queue([{ id: 1, slug: "a", hits: 4 }]);

    await runWithSqlDialect("pgsql", async () => repository.decrementById(1, "hits", 5));

    expect(connection.calls[0]?.params).toEqual([-5, 1]);
  });

  test("an unknown column is rejected", () => {
    runWithSqlDialect("pgsql", () => {
      expect(() => buildIncrementQuery(counterTable, 1, "nope" as never, 1)).toThrow(
        /Unknown column/,
      );
    });
  });

  test("a non-finite amount is rejected", () => {
    runWithSqlDialect("pgsql", () => {
      expect(() => buildIncrementQuery(counterTable, 1, "hits", Number.NaN)).toThrow(/finite/);
      expect(() => buildIncrementQuery(counterTable, 1, "hits", Number.POSITIVE_INFINITY)).toThrow(
        /finite/,
      );
    });
  });
});

describe("subquery counts", () => {
  test("the subquery is aliased and its placeholders are renumbered before the where clause", () => {
    const { text, params } = runWithSqlDialect("pgsql", () =>
      buildSelectQuery(counterTable, {
        select: [
          { kind: "column", table: "counters", column: "id" },
          {
            kind: "subqueryCount",
            sql: 'SELECT COUNT(*) FROM "hits" WHERE "hits"."cid" = "counters"."id" AND "hits"."ok" = $1',
            params: [true],
            as: "hits_count",
          },
        ],
        where: { slug: "a" },
      } as never),
    ) as unknown as { text: string; params: unknown[] };

    expect(text).toContain('AS "hits_count"');
    expect(text).toContain('"hits"."ok" = $1');
    expect(text).toContain('"counters"."slug" = $2');
    expect(params).toEqual([true, "a"]);
  });
});

describe("chunkById", () => {
  test("walks keyset pages and stops when a page is short", async () => {
    const connection = new FakeConnection();
    const repository = new CounterRepository(connection);
    connection.queue([
      { id: 1, slug: "a", hits: 0 },
      { id: 2, slug: "b", hits: 0 },
      { id: 3, slug: "c", hits: 0 },
    ]);
    connection.queue([{ id: 3, slug: "c", hits: 0 }]);

    const seen: number[][] = [];
    await runWithSqlDialect("pgsql", async () =>
      repository.chunkById(2, async (rows) => {
        seen.push(rows.map((row) => row.id));
        return undefined;
      }),
    );

    expect(seen).toEqual([[1, 2], [3]]);
  });

  test("uses a keyset cursor rather than OFFSET", async () => {
    const connection = new FakeConnection();
    const repository = new CounterRepository(connection);
    connection.queue([
      { id: 1, slug: "a", hits: 0 },
      { id: 2, slug: "b", hits: 0 },
      { id: 3, slug: "c", hits: 0 },
    ]);
    connection.queue([]);

    await runWithSqlDialect("pgsql", async () => repository.chunkById(2, async () => undefined));

    expect(connection.calls[0]?.query).not.toContain("OFFSET");
    expect(connection.calls[1]?.params).toContain(2);
  });

  test("returning false stops the walk", async () => {
    const connection = new FakeConnection();
    const repository = new CounterRepository(connection);
    connection.queue([
      { id: 1, slug: "a", hits: 0 },
      { id: 2, slug: "b", hits: 0 },
      { id: 3, slug: "c", hits: 0 },
    ]);

    let pages = 0;
    await runWithSqlDialect("pgsql", async () =>
      repository.chunkById(2, async () => {
        pages += 1;
        return false;
      }),
    );

    expect(pages).toBe(1);
    expect(connection.calls).toHaveLength(1);
  });

  test("an empty table invokes the callback zero times", async () => {
    const connection = new FakeConnection();
    const repository = new CounterRepository(connection);
    connection.queue([]);

    let pages = 0;
    await runWithSqlDialect("pgsql", async () =>
      repository.chunkById(2, async () => {
        pages += 1;
        return undefined;
      }),
    );

    expect(pages).toBe(0);
  });

  test("a non-positive chunk size is rejected", async () => {
    const repository = new CounterRepository(new FakeConnection());

    await expect(repository.chunkById(0, async () => undefined)).rejects.toThrow(
      /positive integer/,
    );
  });
});
