import { describe, expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { RepositoryQuery } from "@getstrata/core/database/repositoryQuery";
import { defineTable } from "@getstrata/core/database/table";

type Post = {
  id: number;
  title: string;
  published_at: Date;
};

const postTable = defineTable<Post, "id">({
  name: "post",
  primaryKey: "id",
  columns: ["id", "title", "published_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
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

class PostRepository extends BaseRepository<Post, "id"> {
  constructor(connection: DatabaseConnection) {
    super(postTable, connection);
  }
}

describe("Phase 3 BaseRepository chunk and cursorPaginate", () => {
  test("chunk iterates result sets until callback stops or rows are exhausted", async () => {
    const connection = new FakeConnection();
    const repository = new PostRepository(connection);
    const batches: number[][] = [];

    connection.queue([
      { id: 1, title: "One", published_at: new Date() },
      { id: 2, title: "Two", published_at: new Date() },
    ]);
    connection.queue([{ id: 3, title: "Three", published_at: new Date() }]);

    await repository.chunk(2, async (rows) => {
      batches.push(rows.map((row) => row.id));
    });

    expect(batches).toEqual([[1, 2], [3]]);
    expect(connection.calls).toHaveLength(2);
    expect(connection.calls[0]?.query).toContain("LIMIT 2 OFFSET 0");
    expect(connection.calls[1]?.query).toContain("LIMIT 2 OFFSET 2");
  });

  test("cursorPaginate returns next cursor metadata for keyset pagination", async () => {
    const connection = new FakeConnection();
    const repository = new PostRepository(connection);

    connection.queue([
      { id: 11, title: "Eleven", published_at: new Date() },
      { id: 12, title: "Twelve", published_at: new Date() },
      { id: 13, title: "Thirteen", published_at: new Date() },
    ]);

    const result = await repository.cursorPaginate({ perPage: 2, cursor: 10 });

    expect(result.data).toHaveLength(2);
    expect(result.meta).toEqual({
      per_page: 2,
      next_cursor: 12,
      prev_cursor: 10,
      has_more: true,
    });
    expect(connection.calls[0]?.query).toContain('"post"."id" > $1');
    expect(connection.calls[0]?.query).toContain("LIMIT 3");
  });
});

describe("Phase 3 RepositoryQuery offset, paginate, and joins", () => {
  test("supports offset and paginate on fluent queries", async () => {
    const connection = new FakeConnection();
    const repository = new PostRepository(connection);

    connection.queue([{ count: "42" }]);
    connection.queue([{ id: 21, title: "Paged", published_at: new Date() }]);

    const result = await repository.query().offset(20).paginate({ page: 3, perPage: 10 });

    expect(result.meta.total).toBe(42);
    expect(result.data[0]?.title).toBe("Paged");
    expect(connection.calls[1]?.query).toContain("LIMIT 10 OFFSET 20");
  });

  test("supports join and orWhere on fluent queries", async () => {
    const connection = new FakeConnection();
    const repository = new PostRepository(connection);

    connection.queue([{ id: 1, title: "Joined", published_at: new Date() }]);

    await new RepositoryQuery(repository)
      .join("post.id", "author.post_id")
      .where({ title: { ilike: "join" } })
      .orWhere({ title: { ilike: "query" } })
      .get();

    expect(connection.calls[0]?.query).toContain('INNER JOIN "author"');
    expect(connection.calls[0]?.query).toContain("ILIKE");
    expect(connection.calls[0]?.query).toContain(" OR ");
  });

  test("supports leftJoin, groupBy, and having on fluent queries", async () => {
    const connection = new FakeConnection();
    const repository = new PostRepository(connection);

    connection.queue([{ id: 1, title: "Grouped", published_at: new Date() }]);

    await new RepositoryQuery(repository)
      .leftJoin("post.id", "author.post_id")
      .groupBy(["title"])
      .having({ title: { ilike: "group" } })
      .get();

    expect(connection.calls[0]?.query).toContain('LEFT JOIN "author"');
    expect(connection.calls[0]?.query).toContain("GROUP BY");
    expect(connection.calls[0]?.query).toContain("HAVING");
  });
});
