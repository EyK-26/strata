import { test as bunTest, expect } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import type { KeysetCursor } from "@getstrata/core/pagination";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = {
  id: number;
  stamp: string;
  active: number;
  label: string;
  score: number;
  deleted_at: string | null;
};
const table = defineTable<Row, "id">({
  name: "keyset_rows",
  primaryKey: "id",
  columns: ["id", "stamp", "active", "label", "score", "deleted_at"],
  softDeletes: true,
});
class VisibleModel extends Model<Row, "id"> {}
class ChildModel extends Model<Row, "id"> {}
class ParentModel extends Model<Row, "id"> {
  children() {
    return this.hasMany(childDefinition, "active");
  }
}
const repositoryDefinition = defineRepository({
  name: "keyset.repo",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const visibleDefinition = defineModel({
  name: "Visible",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  scopes: [(query) => query.where({ active: 1 })],
  construct: (state, binding) => new VisibleModel(state, binding),
});
const childDefinition = defineModel({
  name: "Child",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new ChildModel(state, binding),
});
const parentDefinition = defineModel({
  name: "Parent",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new ParentModel(state, binding),
});
const collisionTable = defineTable<{ id: number; __STRATA_KEYSET_0: string }, "id">({
  name: "keyset_rows",
  primaryKey: "id",
  columns: ["id", "__STRATA_KEYSET_0"],
});
const collisionDefinition = defineRepository({
  name: "collision.repo",
  table: collisionTable,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
function requireCursor(cursor: KeysetCursor | null): KeysetCursor {
  if (!cursor) throw Error("Expected a continuation cursor.");
  return cursor;
}
const order = [
  { column: "stamp", direction: "desc" },
  { column: "id", direction: "desc" },
] as const;
async function withFixture(
  work: (ports: {
    repo: BaseRepository<Row, "id">;
    db: { unsafe: <T>(text: string, params?: readonly unknown[]) => Promise<readonly T[]> };
    Visible: import("@getstrata/core/database/definitions").BoundModel<Row, "id", VisibleModel>;
    Parent: import("@getstrata/core/database/definitions").BoundModel<Row, "id", ParentModel>;
    collisionRepository: BaseRepository<{ id: number; __STRATA_KEYSET_0: string }, "id">;
  }) => unknown,
) {
  return withBoundDatabase(
    {
      definition: {
        default: "test",
        connections: { test: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repositoryDefinition, collisionDefinition],
        models: [visibleDefinition, childDefinition, parentDefinition],
      },
    },
    async (database) => {
      const db = {
        unsafe: <T>(text: string, params: readonly unknown[] = []) =>
          database.execute<T>({ text, params }),
      };
      await db.unsafe(
        "CREATE TABLE keyset_rows (id INTEGER PRIMARY KEY,stamp TEXT,active INTEGER,label TEXT,score REAL,deleted_at TEXT)",
      );
      await db.unsafe(
        "INSERT INTO keyset_rows VALUES (10,'2030-01-01 00:00:00.000001',1,'a',1.0000000000000002,NULL),(2,'2030-01-01 00:00:00.000002',1,'b',1.0000000000000004,NULL),(8,'2030-01-01 00:00:00.000002',1,'c',2,NULL),(1,'2030-01-02',0,'hidden',3,NULL),(3,'2030-01-03',1,'deleted',4,'2030-01-04')",
      );
      await work({
        repo: database.repository(repositoryDefinition),
        db,
        Visible: database.model(visibleDefinition),
        Parent: database.model(parentDefinition),
        collisionRepository: database.repository(collisionDefinition),
      });
    },
  );
}
function test(name: string, work: Parameters<typeof withFixture>[0]) {
  bunTest(name, () => withFixture(work));
}

test("timestamp ties and nonmonotonic IDs traverse without skipping or repeating", async ({
  repo,
}) => {
  let cursor: KeysetCursor | undefined;
  const ids: number[] = [];
  do {
    const page = await repo.query().keysetPaginate({ perPage: 1, orderBy: order, cursor });
    ids.push(...page.data.map((r) => r.id));
    expect(Object.keys(page.data[0] ?? {}).some((k) => k.startsWith("__strata"))).toBe(false);
    cursor = page.meta.next_cursor ?? undefined;
  } while (cursor);
  expect(ids).toEqual([1, 8, 2, 10]);
  const empty = await repo
    .query()
    .where({ id: 999 })
    .keysetPaginate({ perPage: 2, orderBy: order });
  expect(empty.meta.has_more).toBe(false);
  expect(empty.meta.next_cursor).toBeNull();
  expect(empty.data).toEqual([]);
});

test("mixed directions and SQLite REAL cursor precision preserve adjacent doubles", async ({
  repo,
}) => {
  const mixed = [
    { column: "stamp", direction: "desc" },
    { column: "id", direction: "asc" },
  ] as const;
  expect(
    (await repo.keysetPaginate({ perPage: 10, orderBy: mixed })).data.map((r) => r.id),
  ).toEqual([1, 2, 8, 10]);
  const orderBy = [
    { column: "score", direction: "asc" },
    { column: "id", direction: "asc" },
  ] as const;
  const first = await repo.query().keysetPaginate({ perPage: 1, orderBy });
  const next = await repo
    .query()
    .keysetPaginate({ perPage: 1, orderBy, cursor: requireCursor(first.meta.next_cursor) });
  expect(first.data[0]?.id).toBe(10);
  expect(next.data[0]?.id).toBe(2);
});

test("boundary survives deletion, excludes new rows before it and includes rows after it", async ({
  repo,
  db,
}) => {
  const first = await repo
    .query()
    .where({ active: 1 })
    .keysetPaginate({ perPage: 1, orderBy: order });
  await db.unsafe("DELETE FROM keyset_rows WHERE id=8");
  await db.unsafe(
    "INSERT INTO keyset_rows VALUES (9,'2031-01-01',1,'new-before',5,NULL),(11,'2029-01-01',1,'new-after',6,NULL)",
  );
  const page = await repo
    .query()
    .where({ active: 1 })
    .keysetPaginate({
      perPage: 10,
      orderBy: order,
      cursor: JSON.parse(JSON.stringify(first.meta.next_cursor)),
    });
  expect(page.data.map((r) => r.id)).toEqual([2, 10, 11]);
});

test("model/global/caller OR scopes intersect the cursor; projections stay partial", async ({
  Visible,
  repo,
}) => {
  const first = await Visible.query()
    .where((q) => q.where({ label: "a" }).orWhere({ label: "b" }).orWhere({ label: "hidden" }))
    .keysetPaginate({ perPage: 1, orderBy: order });
  expect(first.data.map((r) => r.get("id"))).toEqual([2]);
  const page = await Visible.query()
    .where((q) => q.where({ label: "a" }).orWhere({ label: "hidden" }))
    .select("label")
    .keysetPaginate({ perPage: 1, orderBy: order, cursor: requireCursor(first.meta.next_cursor) });
  expect(page.data).toEqual([{ label: "a" }]);
  expect(
    (await Visible.keysetPaginate({ perPage: 10, orderBy: order })).data.map((r) => r.get("id")),
  ).toEqual([8, 2, 10]);
  expect(
    (await repo.query().withTrashed().keysetPaginate({ perPage: 10, orderBy: order })).data[0]?.id,
  ).toBe(3);
  const projected = await repo.query().projectKeyset(["label"], { perPage: 1, orderBy: order });
  expect(projected.data).toEqual([{ label: "hidden" }]);
});

test("invalid options and cursor shapes fail before database access", async ({ repo }) => {
  const valid = requireCursor(
    (await repo.keysetPaginate({ perPage: 1, orderBy: order })).meta.next_cursor,
  );
  for (const options of [
    { perPage: 0, orderBy: order },
    { perPage: 1001, orderBy: order },
    { perPage: 1.5, orderBy: order },
    { perPage: 1, orderBy: [] },
    { perPage: 1, orderBy: [{ column: "stamp", direction: "desc" }] },
    {
      perPage: 1,
      orderBy: [
        { column: "unknown", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
    },
    {
      perPage: 1,
      orderBy: [
        { column: "id", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    },
    { perPage: 1, orderBy: [{ column: "id", direction: "wrong" }] },
    ...[
      null,
      {},
      { ...valid, version: 2 },
      { ...valid, values: [] },
      { ...valid, values: [null, "1"] },
      { ...valid, values: ["x".repeat(4097), "1"] },
      { ...valid, values: Array(2) },
      {
        ...valid,
        order: [
          { column: "stamp", direction: "asc" },
          { column: "id", direction: "desc" },
        ],
      },
    ].map((cursor) => ({ perPage: 1, orderBy: order, cursor })),
  ])
    await expect(repo.keysetPaginate(options as never)).rejects.toThrow();
  await expect(
    repo.query().offset(1).keysetPaginate({ perPage: 1, orderBy: order }),
  ).rejects.toThrow();
  await expect(
    repo.query().limit(1).keysetPaginate({ perPage: 1, orderBy: order }),
  ).rejects.toThrow();
  await expect(
    repo.query().groupBy("active").keysetPaginate({ perPage: 1, orderBy: order }),
  ).rejects.toThrow();
  await expect(repo.query().projectKeyset([], { perPage: 1, orderBy: order })).rejects.toThrow();
  await expect(
    repo.query().projectKeyset(["unknown"] as never, { perPage: 1, orderBy: order }),
  ).rejects.toThrow();
});

test("hostile cursor values are bound; null source keys and oversized keys fail explicitly", async ({
  repo,
  db,
}) => {
  const cursor = requireCursor(
    (await repo.keysetPaginate({ perPage: 1, orderBy: order })).meta.next_cursor,
  );
  await repo.keysetPaginate({
    perPage: 1,
    orderBy: order,
    cursor: { ...cursor, values: ["' OR 1=1 --", "1"] },
  });
  expect(await repo.count()).toBe(4);
  await db.unsafe("UPDATE keyset_rows SET stamp=NULL WHERE id=1");
  await expect(repo.keysetPaginate({ perPage: 10, orderBy: order })).rejects.toThrow("non-null");
  await db.unsafe("UPDATE keyset_rows SET stamp=? WHERE id=1", ["x".repeat(4097)]);
  await expect(repo.keysetPaginate({ perPage: 1, orderBy: order })).rejects.toThrow("bounded");
});

test("model pages eager-load visible relations and honor the maximum page size", async ({
  Parent,
}) => {
  const page = await Parent.query()
    .with("children")
    .keysetPaginate({ perPage: 1000, orderBy: order });
  expect(page.data.map((r) => r.get("id"))).toEqual([1, 8, 2, 10]);
  const parent = page.data.find((r) => r.get("id") === 1);
  expect(
    parent
      ?.loaded<Array<{ id: number }>>("children")
      ?.map((r) => r.id)
      .sort((a, b) => a - b),
  ).toEqual([2, 8, 10]);
  expect(page.meta.next_cursor).toBeNull();
});

test("reserved cursor aliases are rejected case-insensitively", async ({
  repo,
  collisionRepository,
}) => {
  await expect(
    collisionRepository.keysetPaginate({
      perPage: 1,
      orderBy: [{ column: "id", direction: "asc" }],
    }),
  ).rejects.toThrow("reserved");
  await expect(
    repo.keysetPaginate({
      perPage: 1,
      orderBy: order,
      select: [{ kind: "column", table: table.name, column: "label", as: "__STRATA_KEYSET_0" }],
    }),
  ).rejects.toThrow("reserved");
});

test("three-column mixed ordering compares every equal prefix", async ({ repo, db }) => {
  await db.unsafe("INSERT INTO keyset_rows VALUES (12,'2030-01-01',1,'tie',2,NULL)");
  const orderBy = [
    { column: "active", direction: "asc" },
    { column: "score", direction: "asc" },
    { column: "id", direction: "desc" },
  ] as const;
  const ids: number[] = [];
  let cursor: KeysetCursor | undefined;
  do {
    const page = await repo.query().keysetPaginate({ perPage: 1, orderBy, cursor });
    ids.push(...page.data.map((r) => r.id));
    cursor = page.meta.next_cursor ?? undefined;
  } while (cursor);
  expect(ids).toEqual([1, 10, 2, 12, 8]);
});
