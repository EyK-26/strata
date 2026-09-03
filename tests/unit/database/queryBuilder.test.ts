import { describe, expect, test } from "bun:test";
import {
  buildAdvancedWhereClause,
  buildCountQuery,
  buildJoinClause,
  buildSelectQuery,
  parseQualifiedColumn,
  resolveQualifiedColumn,
} from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";
import { WhereBuilder } from "@getstrata/core/database/whereBuilder";

type Article = {
  id: number;
  title: string;
  status: string;
  category_id: number;
  view_count: number;
};

const articleTable = defineTable<Article, "id">({
  name: "article",
  primaryKey: "id",
  columns: ["id", "title", "status", "category_id", "view_count"],
});

describe("Phase 3 query builder: orWhere and nested groups", () => {
  test("rejects malformed qualified column references", () => {
    expect(() => resolveQualifiedColumn("article", "bad.")).toThrow(
      "Invalid qualified column: bad.",
    );
    expect(() => parseQualifiedColumn("invalid")).toThrow(
      "Join columns must be qualified as table.column: invalid",
    );
  });

  test("builds OR conditions from where nodes", () => {
    const { clause, params } = buildAdvancedWhereClause<Article>("article", {}, [
      { kind: "or", where: { status: "draft" } },
      { kind: "or", where: { status: "published" } },
    ]);

    expect(clause).toBe(' WHERE "article"."status" = $1 OR "article"."status" = $2');
    expect(params).toEqual(["draft", "published"]);
  });

  test("builds nested where groups from WhereBuilder", () => {
    const builder = new WhereBuilder<Article>();
    builder.where({ status: "published" }).whereGroup((group) => {
      group.where({ title: { ilike: "%query%" } }).orWhere({ title: { ilike: "%builder%" } });
    });

    const { clause, params } = buildAdvancedWhereClause("article", {}, builder.nodes);

    expect(clause).toBe(
      ' WHERE "article"."status" = $1 AND ("article"."title" ILIKE $2 OR "article"."title" ILIKE $3)',
    );
    expect(params).toEqual(["published", "%query%", "%builder%"]);
  });

  test("supports full-text match operators", () => {
    const { clause, params } = buildAdvancedWhereClause<Article>("article", {
      search_vector: { tsMatch: "roadmap" },
    } as never);

    expect(clause).toContain("@@ plainto_tsquery('english', $1)");
    expect(params).toEqual(["roadmap"]);
  });
});

describe("Phase 3 query builder: joins, groupBy, and having", () => {
  test("builds typed inner and left joins", () => {
    expect(
      buildJoinClause([
        {
          type: "inner",
          table: "category",
          on: [
            {
              left: { table: "article", column: "category_id" },
              right: { table: "category", column: "id" },
            },
          ],
        },
        {
          type: "left",
          table: "author",
          on: [
            {
              left: { table: "article", column: "id" },
              right: { table: "author", column: "article_id" },
            },
          ],
        },
      ]),
    ).toBe(
      ' INNER JOIN "category" ON "article"."category_id" = "category"."id" LEFT JOIN "author" ON "article"."id" = "author"."article_id"',
    );
  });

  test("builds select queries with joins, groupBy, and having", () => {
    const { text, params } = buildSelectQuery(articleTable, {
      joins: [
        {
          type: "inner",
          table: "category",
          on: [
            {
              left: { table: "article", column: "category_id" },
              right: { table: "category", column: "id" },
            },
          ],
        },
      ],
      where: { "category.slug": "news" },
      groupBy: ["category_id"],
      having: { view_count: { gte: 10 } },
      orderBy: { view_count: "desc" },
      limit: 5,
    });

    expect(text).toContain('INNER JOIN "category"');
    expect(text).toContain('"category"."slug" = $1');
    expect(text).toContain(' GROUP BY "article"."category_id"');
    expect(text).toContain(' HAVING "article"."view_count" >= $2');
    expect(text).toContain(' ORDER BY "article"."view_count" DESC LIMIT 5');
    expect(params).toEqual(["news", 10]);
  });

  test("builds count queries with joins", () => {
    const { text } = buildCountQuery(
      articleTable,
      { status: "published" },
      {
        joins: [
          {
            type: "inner",
            table: "category",
            on: [
              {
                left: { table: "article", column: "category_id" },
                right: { table: "category", column: "id" },
              },
            ],
          },
        ],
      },
    );

    expect(text).toContain('SELECT COUNT(*) AS count FROM "article"');
    expect(text).toContain('INNER JOIN "category"');
    expect(text).toContain('"article"."status" = $1');
  });

  test("builds custom select expressions for search projections", () => {
    const { text, params } = buildSelectQuery(articleTable, {
      select: [
        { kind: "literalText", value: "article", as: "type" },
        { kind: "column", table: "article", column: "id", as: "id" },
        { kind: "column", table: "article", column: "title", as: "snippet" },
        {
          kind: "tsRank",
          table: "article",
          column: "search_vector",
          query: "framework",
          as: "rank",
        },
      ],
      where: { search_vector: { tsMatch: "framework" } } as never,
      limit: 10,
    });

    expect(text).toContain('$1::text AS "type"');
    expect(text).toContain('ts_rank("article"."search_vector", plainto_tsquery');
    expect(params).toEqual(["article", "framework", "framework"]);
  });
});
