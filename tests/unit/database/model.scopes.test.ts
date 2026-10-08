/** biome-ignore-all lint/complexity/noThisInStatic: Inherited model boot must register scopes on the concrete subclass. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; active: number; label: string };
const table = defineTable<Row, "id">({
  name: "scope_rows",
  primaryKey: "id",
  columns: ["id", "active", "label"],
});
let connection: ReturnType<typeof createSqliteConnection>;
function model() {
  return class Visible extends defineModel(table) {
    static override boot() {
      this.addGlobalScope<Row, "id">("visible", (query) => query.where({ active: 1 }));
    }
  };
}
beforeEach(async () => {
  connection = createSqliteConnection(":memory:");
  bindDatabaseConnection(connection);
  useSqlDialect("sqlite");
  await connection.unsafe(
    "CREATE TABLE scope_rows (id INTEGER PRIMARY KEY, active INTEGER, label TEXT)",
  );
  await connection.unsafe(
    "INSERT INTO scope_rows VALUES (1, 1, 'a'), (2, 0, 'hidden'), (3, 1, 'b'), (4, 0, 'hidden')",
  );
});
afterEach(() => {
  connection.close();
  resetBoundDatabaseConnection();
  resetSqlDialect();
});

describe("model scope composition", () => {
  test("repeated column predicates intersect rather than overwrite", async () => {
    expect(await model().where({ active: 0 }).get()).toEqual([]);
    expect(
      await model().repository<Row, "id">().query().where({ id: 1 }).where({ id: 3 }).get(),
    ).toEqual([]);
  });
  test("top-level and callback OR predicates cannot escape global scopes", async () => {
    const Visible = model();
    expect(
      (await Visible.query().where({ id: 1 }).orWhere({ id: 2 }).get()).map((row) => row.id),
    ).toEqual([1]);
    expect(
      (
        await Visible.query()
          .where((builder) => builder.where({ id: 1 }).orWhere({ id: 2 }))
          .get()
      ).map((row) => row.id),
    ).toEqual([1]);
    expect((await Visible.query().orWhere({ id: 2 }).get()).map((row) => row.id)).toEqual([]);
  });
  test("scope OR groups remain separate from caller filters", async () => {
    class Selected extends defineModel(table) {
      static override boot() {
        Selected.addGlobalScope<Row, "id">("selection", (query) =>
          query.where({ id: 1 }).orWhere({ id: 3 }),
        );
      }
    }
    expect((await Selected.where({ id: 3 }).get()).map((row) => row.id)).toEqual([3]);
  });
  test("cursor pages and chunks retain scopes across boundaries", async () => {
    const Visible = model();
    const first = await Visible.cursorPaginate({ perPage: 1 });
    expect(first.data.map((row) => row.id)).toEqual([1]);
    expect(first.meta.has_more).toBe(true);
    expect(
      (await Visible.cursorPaginate({ perPage: 1, cursor: first.meta.next_cursor })).data.map(
        (row) => row.id,
      ),
    ).toEqual([3]);
    const ids: number[] = [];
    await Visible.chunk(1, async (rows) => {
      ids.push(...rows.map((row) => row.id));
    });
    expect(ids).toEqual([1, 3]);
    const early: number[] = [];
    await Visible.chunk(1, async (rows) => {
      early.push(...rows.map((row) => row.id));
      return false;
    });
    expect(early).toEqual([1]);
  });
  test("cursor bounds intersect existing key and OR predicates", async () => {
    const repository = model().repository<Row, "id">();
    expect(
      (
        await repository
          .query()
          .where({ id: 1 })
          .orWhere({ id: 3 })
          .cursorPaginate({ perPage: 10, cursor: 3 })
      ).data,
    ).toEqual([]);
    expect(
      (await repository.cursorPaginate({ perPage: 10, cursor: 1, where: { id: 1 } })).data,
    ).toEqual([]);
  });
  test("counts, projections and offset pages retain the same scope", async () => {
    const Visible = model();
    expect(await Visible.query().where({ active: 0 }).count()).toBe(0);
    expect(await Visible.query().pluck("id")).toEqual([1, 3]);
    expect(
      (await Visible.query().paginate({ page: 2, perPage: 1 })).data.map((row) => row.id),
    ).toEqual([3]);
  });
  test("multiple scope groups intersect and inherited boot applies to subclasses", async () => {
    const Visible = model();
    class Subset extends Visible {
      static override boot() {
        super.boot();
        this.addGlobalScope<Row, "id">("subset", (query) =>
          query.where({ id: 1 }).orWhere({ id: 2 }),
        );
      }
    }
    expect((await Subset.query().orWhere({ id: 3 }).get()).map((row) => row.id)).toEqual([]);
    expect((await Subset.all()).map((row) => row.id)).toEqual([1]);
  });
  test("predicate objects are snapshotted and callback conditions are grouped", async () => {
    const repository = model().repository<Row, "id">();
    const filter = { id: 1 };
    const query = repository.query().where(filter);
    filter.id = 2;
    expect((await query.get()).map((row) => row.id)).toEqual([1]);
    expect(
      await repository
        .query()
        .where({ id: 3 })
        .where((builder) => builder.where({ id: 1 }).orWhere({ id: 2 }))
        .get(),
    ).toEqual([]);
    expect(await repository.query({ active: 1 }).protectWhere().orWhere({ id: 2 }).get()).toEqual(
      [],
    );
    expect(
      (
        await repository
          .query()
          .where(() => {})
          .protectWhere()
          .get()
      ).length,
    ).toBe(4);
  });
  test("explicit repository access remains unscoped", async () => {
    expect((await model().repository<Row, "id">().findAll()).map((row) => row.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
