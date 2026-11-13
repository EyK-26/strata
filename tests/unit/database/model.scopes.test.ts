import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = { id: number; active: number; label: string };
const table = defineTable<Row, "id">({
  name: "scope_rows",
  primaryKey: "id",
  columns: ["id", "active", "label"],
});
const repository = defineRepository({
  name: "scope_rows",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
class Entity extends Model<Row, "id"> {}
const visibleScope = (query: ReturnType<BaseRepository<Row, "id">["query"]>) =>
  query.where({ active: 1 });
const selectedScope = (query: ReturnType<BaseRepository<Row, "id">["query"]>) =>
  query.where({ id: 1 }).orWhere({ id: 3 });
const Visible = defineModel({
  name: "Visible",
  repository,
  dependencies: [],
  attributes: {},
  scopes: [visibleScope],
  construct: (state, binding) => new Entity(state, binding),
});
const Selected = defineModel({
  name: "Selected",
  repository,
  dependencies: [],
  attributes: {},
  scopes: [selectedScope],
  construct: (state, binding) => new Entity(state, binding),
});
const Subset = defineModel({
  name: "Subset",
  repository,
  dependencies: [],
  attributes: {},
  scopes: [visibleScope, (query) => query.where({ id: 1 }).orWhere({ id: 2 })],
  construct: (state, binding) => new Entity(state, binding),
});
async function fixture(
  work: (database: Parameters<Parameters<typeof withBoundDatabase>[1]>[0]) => Promise<void>,
) {
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repository],
        models: [Visible, Selected, Subset],
      },
    },
    async (database) => {
      await database.execute({
        text: "CREATE TABLE scope_rows (id INTEGER PRIMARY KEY, active INTEGER, label TEXT)",
        params: [],
      });
      await database.execute({
        text: "INSERT INTO scope_rows VALUES (1, 1, 'a'), (2, 0, 'hidden'), (3, 1, 'b'), (4, 0, 'hidden')",
        params: [],
      });
      await work(database);
    },
  );
}
describe("model scope composition", () => {
  test("repeated column predicates intersect rather than overwrite", () =>
    fixture(async (db) => {
      expect(await db.model(Visible).where({ active: 0 }).get()).toEqual([]);
      expect(
        await db.repository(repository).query().where({ id: 1 }).where({ id: 3 }).get(),
      ).toEqual([]);
    }));
  test("top-level and callback OR predicates cannot escape global scopes", () =>
    fixture(async (db) => {
      const model = db.model(Visible);
      expect(
        (await model.query().where({ id: 1 }).orWhere({ id: 2 }).get()).map((row) => row.id),
      ).toEqual([1]);
      expect(
        (
          await model
            .query()
            .where((builder) => builder.where({ id: 1 }).orWhere({ id: 2 }))
            .get()
        ).map((row) => row.id),
      ).toEqual([1]);
      expect((await model.query().orWhere({ id: 2 }).get()).map((row) => row.id)).toEqual([]);
    }));
  test("scope OR groups remain separate from caller filters", () =>
    fixture(async (db) => {
      expect((await db.model(Selected).where({ id: 3 }).get()).map((row) => row.id)).toEqual([3]);
    }));
  test("cursor pages and chunks retain scopes across boundaries", () =>
    fixture(async (db) => {
      const model = db.model(Visible);
      const first = await model.cursorPaginate({ perPage: 1 });
      expect(first.data.map((row) => row.id)).toEqual([1]);
      expect(first.meta.has_more).toBe(true);
      expect(
        (await model.cursorPaginate({ perPage: 1, cursor: first.meta.next_cursor })).data.map(
          (row) => row.id,
        ),
      ).toEqual([3]);
      const ids: number[] = [];
      await model.chunk(1, async (rows) => {
        ids.push(...rows.map((row) => row.id));
      });
      expect(ids).toEqual([1, 3]);
      const early: number[] = [];
      await model.chunk(1, async (rows) => {
        early.push(...rows.map((row) => row.id));
        return false;
      });
      expect(early).toEqual([1]);
    }));
  test("cursor bounds intersect existing key and OR predicates", () =>
    fixture(async (db) => {
      const repo = db.repository(repository);
      expect(
        (
          await repo
            .query()
            .where({ id: 1 })
            .orWhere({ id: 3 })
            .cursorPaginate({ perPage: 10, cursor: 3 })
        ).data,
      ).toEqual([]);
      expect(
        (await repo.cursorPaginate({ perPage: 10, cursor: 1, where: { id: 1 } })).data,
      ).toEqual([]);
    }));
  test("counts, projections and offset pages retain the same scope", () =>
    fixture(async (db) => {
      const model = db.model(Visible);
      expect(await model.query().where({ active: 0 }).count()).toBe(0);
      expect(await model.query().pluck("id")).toEqual([1, 3]);
      expect(
        (await model.query().paginate({ page: 2, perPage: 1 })).data.map((row) => row.id),
      ).toEqual([3]);
    }));
  test("multiple immutable scope groups intersect for a separately defined template", () =>
    fixture(async (db) => {
      expect(
        (await db.model(Subset).query().orWhere({ id: 3 }).get()).map((row) => row.id),
      ).toEqual([]);
      expect((await db.model(Subset).all()).map((row) => row.id)).toEqual([1]);
    }));
  test("predicate objects are snapshotted and callback conditions are grouped", () =>
    fixture(async (db) => {
      const repo = db.repository(repository);
      const filter = { id: 1 };
      const query = repo.query().where(filter);
      filter.id = 2;
      expect((await query.get()).map((row) => row.id)).toEqual([1]);
      expect(
        await repo
          .query()
          .where({ id: 3 })
          .where((builder) => builder.where({ id: 1 }).orWhere({ id: 2 }))
          .get(),
      ).toEqual([]);
      expect(await repo.query({ active: 1 }).protectWhere().orWhere({ id: 2 }).get()).toEqual([]);
      expect(
        (
          await repo
            .query()
            .where(() => {})
            .protectWhere()
            .get()
        ).length,
      ).toBe(4);
    }));
  test("explicit repository access remains unscoped", () =>
    fixture(async (db) => {
      expect((await db.model(Visible).repository().findAll()).map((row) => row.id)).toEqual([
        1, 2, 3, 4,
      ]);
    }));
});
