import { expect, test } from "bun:test";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import type { QueryOptions, QueryWhere } from "@getstrata/core/database/types";

type Child = {
  id: number;
  owner_id: number;
  kind: string;
  score: number;
  deleted_at: string | null;
};
type Pivot = { id: number; owner_id: number; child_id: number };
const childTable = defineTable<Child, "id">({
  name: "limited_children",
  primaryKey: "id",
  columns: ["id", "owner_id", "kind", "score", "deleted_at"],
  softDeletes: true,
});
const pivotTable = defineTable<Pivot, "id">({
  name: "limited_pivot",
  primaryKey: "id",
  columns: ["id", "owner_id", "child_id"],
});

async function fixture(
  check: (f: {
    children: BaseRepository<Child, "id">;
    queries: string[];
    reads: { count: number };
  }) => Promise<void>,
) {
  const db = createSqliteConnection(":memory:");
  const queries: string[] = [],
    reads = { count: 0 };
  const observed: DatabaseConnection = {
    async unsafe<T>(query: string, params: readonly unknown[] = []) {
      queries.push(query);
      return db.unsafe<T>(query, params);
    },
  };
  class VisibleChildren extends BaseRepository<Child, "id"> {
    #visible = "keep";
    constructor(connection: DatabaseConnection) {
      super(childTable, connection);
    }
    protected override cloneWithConnection(connection: DatabaseConnection): this {
      return new VisibleChildren(connection) as this;
    }
    protected override findWhere(
      where: QueryWhere<Child>,
      options: Omit<QueryOptions<Child>, "where"> = {},
    ) {
      reads.count++;
      return super.findWhere(where, {
        ...options,
        whereNodes: [
          ...(options.whereNodes ?? []),
          { kind: "and", where: { kind: this.#visible } },
        ],
      });
    }
  }
  try {
    await runWithSqlDialect("sqlite", async () => {
      // Schema-only fixtures; rows and relationship reads use public repositories.
      await db.unsafe(
        "CREATE TABLE limited_children(id INTEGER PRIMARY KEY,owner_id INTEGER,kind TEXT,score INTEGER,deleted_at TEXT)",
      );
      await db.unsafe(
        "CREATE TABLE limited_pivot(id INTEGER PRIMARY KEY,owner_id INTEGER,child_id INTEGER)",
      );
      const children = new BaseRepository(childTable, db),
        pivot = new BaseRepository(pivotTable, db);
      for (let id = 1; id <= 7; id++) {
        const owner_id = id <= 3 || id === 7 ? 1 : 2;
        await children.create({
          id,
          owner_id,
          kind: id % 3 === 0 ? "drop" : "keep",
          score: id % 3 === 0 ? 99 : id % 3,
          deleted_at: id === 7 ? "2026-01-01" : null,
        });
        await pivot.create({ id, owner_id, child_id: id });
      }
      queries.length = 0;
      await check({ children: new VisibleChildren(db).withConnection(observed), queries, reads });
    });
  } finally {
    await db.close();
  }
}

const parents = [{ id: 1 }, { id: 2 }, { id: 3 }];
for (const relation of ["many", "morph", "through", "pivot"] as const) {
  test(`${relation} eager bounds are per owner, scoped, stable and database-bounded`, async () => {
    await fixture(async ({ children, queries, reads }) => {
      const options: QueryOptions<Child> = {
        limit: 1,
        offset: 1,
        orderBy: { score: "DESC" },
        whereNodes: [{ kind: "and", where: { kind: "keep" } }],
      };
      const result =
        relation === "many"
          ? await children.loadHasManyForParents(
              parents,
              { type: "hasMany", name: "items", localKey: "id", foreignKey: "owner_id" },
              options,
            )
          : relation === "morph"
            ? await children.loadMorphManyForParents(
                parents,
                {
                  type: "morphMany",
                  name: "items",
                  localKey: "id",
                  morphTypeKey: "kind",
                  morphIdKey: "owner_id",
                  morphType: "keep",
                },
                options,
              )
            : relation === "through"
              ? await children.loadHasManyThroughForParents(
                  parents,
                  {
                    type: "hasManyThrough",
                    name: "items",
                    localKey: "id",
                    throughTable: "limited_pivot",
                    firstKey: "owner_id",
                    secondLocalKey: "child_id",
                    secondKey: "id",
                  },
                  options,
                )
              : await children.loadBelongsToManyForParents<
                  { id: number },
                  Child,
                  Pivot,
                  "id",
                  "id",
                  "owner_id",
                  "child_id"
                >(
                  parents,
                  {
                    type: "belongsToMany",
                    name: "items",
                    pivotTable: "limited_pivot",
                    parentKey: "id",
                    relatedKey: "id",
                    foreignPivotKey: "owner_id",
                    relatedPivotKey: "child_id",
                  },
                  children,
                  options,
                );
      expect(parents.map((parent) => result.get(parent.id)?.map((child) => child.id))).toEqual([
        [1],
        [4],
        [],
      ]);
      expect(queries).toHaveLength(relation === "pivot" ? 2 : 1);
      expect(queries.at(-1)).toContain("ROW_NUMBER()");
      if (relation !== "through") expect(reads.count).toBe(1);
      for (const rows of result.values())
        for (const row of rows)
          expect(
            Object.keys(row).some(
              (key) => key.startsWith("__strata_") || key === "__through_parent_id",
            ),
          ).toBe(false);
    });
  });
}

test("limited relation keeps a subclass filter even without an explicit caller filter", async () => {
  await fixture(async ({ children, reads }) => {
    const result = await children.loadHasManyForParents(
      parents,
      { type: "hasMany", name: "items", localKey: "id", foreignKey: "owner_id" },
      { limit: 2, orderBy: { score: "DESC" } },
    );
    expect([...result.values()].map((rows) => rows.map((row) => row.kind))).toEqual([
      ["keep", "keep"],
      ["keep", "keep"],
      [],
    ]);
    expect(reads.count).toBe(1);
  });
});

for (const options of [
  { limit: 0 },
  { limit: 1, groupBy: ["owner_id"] },
  { limit: 1, having: { score: 1 } },
  { limit: -1 },
  { limit: Number.MAX_SAFE_INTEGER, offset: 1 },
  {
    limit: 1,
    select: [
      {
        kind: "column" as const,
        table: "limited_children",
        column: "id",
        as: "__strata_eager_row_number",
      },
    ],
  },
]) {
  test(`limited relation rejects invalid or unsupported bounds ${JSON.stringify(options)}`, async () => {
    await fixture(async ({ children }) => {
      const read = children.loadHasManyForParents(
        parents,
        { type: "hasMany", name: "items", localKey: "id", foreignKey: "owner_id" },
        options,
      );
      await expect(read).rejects.toThrow();
    });
  });
}

test("offset-only eager bounds and default tie ordering preserve the caller options", async () => {
  await fixture(async ({ children, queries }) => {
    const options: QueryOptions<Child> = {
      offset: 1,
      orderBy: [{ column: "score", direction: "DESC" }],
    };
    const snapshot = structuredClone(options);
    const result = await children.loadHasManyForParents(
      parents,
      { type: "hasMany", name: "items", localKey: "id", foreignKey: "owner_id" },
      options,
    );
    expect(parents.map((parent) => result.get(parent.id)?.map((row) => row.id))).toEqual([
      [1],
      [4],
      [],
    ]);
    expect(options).toEqual(snapshot);
    expect(queries).toHaveLength(1);
  });
});
