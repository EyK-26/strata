/** biome-ignore-all lint/complexity/noThisInStatic: Model scope registration binds to the concrete class. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type P = { id: number; child_id: number };
type C = { id: number; parent_id: number; active: number; deleted_at: string | null };
type T = { id: number; active: number; deleted_at: string | null };
type B = { id: number; parent_id: number };
type F = { id: number; bridge_id: number; active: number; deleted_at: string | null };
type I = {
  id: number;
  imageable_type: string;
  imageable_id: number;
  active: number;
  deleted_at: string | null;
};
const parents = defineTable<P, "id">({
  name: "scope_parents",
  primaryKey: "id",
  columns: ["id", "child_id"],
});
const children = defineTable<C, "id">({
  name: "scope_children",
  primaryKey: "id",
  columns: ["id", "parent_id", "active", "deleted_at"],
  softDeletes: true,
});
const tags = defineTable<T, "id">({
  name: "scope_tags",
  primaryKey: "id",
  columns: ["id", "active", "deleted_at"],
  softDeletes: true,
});
const bridges = defineTable<B, "id">({
  name: "scope_bridges",
  primaryKey: "id",
  columns: ["id", "parent_id"],
});
const far = defineTable<F, "id">({
  name: "scope_far",
  primaryKey: "id",
  columns: ["id", "bridge_id", "active", "deleted_at"],
  softDeletes: true,
});
const images = defineTable<I, "id">({
  name: "scope_images",
  primaryKey: "id",
  columns: ["id", "imageable_type", "imageable_id", "active", "deleted_at"],
  softDeletes: true,
});
let connection: ReturnType<typeof createSqliteConnection>;
let calls = 0;
let sqlLog: string[] = [];
function models() {
  class Child extends defineModel(children) {
    static override boot() {
      this.addGlobalScope<C, "id">("active", (q) => q.where({ active: 1 }));
    }
  }
  class Tag extends defineModel(tags) {
    static override boot() {
      this.addGlobalScope<T, "id">("active", (q) => q.where({ active: 1 }));
    }
  }
  class Bridge extends defineModel(bridges) {}
  class Far extends defineModel(far) {
    static override boot() {
      this.addGlobalScope<F, "id">("active", (q) => q.where({ active: 1 }));
    }
  }
  class Image extends defineModel(images) {
    static override boot() {
      this.addGlobalScope<I, "id">("active", (q) => q.where({ active: 1 }));
    }
    imageable() {
      return this.morphTo({ parents: Parent, children: Child }, "imageable");
    }
  }
  class Parent extends defineModel(parents) {
    static override $morphClass = "parents";
    children() {
      return this.hasMany<C, "id">(Child, "parent_id");
    }
    firstChild() {
      return this.hasOne<C, "id">(Child, "parent_id");
    }
    child() {
      return this.belongsTo(Child, "child_id");
    }
    tags() {
      return this.belongsToMany(Tag, "scope_pivot", "parent_id", "tag_id");
    }
    far() {
      return this.hasManyThrough<F, B, "id", "id">(Far, Bridge, "parent_id", "bridge_id");
    }
    images() {
      return this.morphMany(Image, "imageable");
    }
    image() {
      return this.morphOne(Image, "imageable");
    }
    filtered() {
      return this.children().where({ id: 1 });
    }
    rejected() {
      return this.children().where({ active: 0 });
    }
  }
  return { Parent, Child, Tag, Image };
}
beforeEach(async () => {
  connection = createSqliteConnection(":memory:");
  useSqlDialect("sqlite");
  for (const sql of [
    "CREATE TABLE scope_parents(id INTEGER PRIMARY KEY, child_id INTEGER)",
    "CREATE TABLE scope_children(id INTEGER PRIMARY KEY, parent_id INTEGER, active INTEGER, deleted_at TEXT)",
    "CREATE TABLE scope_tags(id INTEGER PRIMARY KEY, active INTEGER, deleted_at TEXT)",
    "CREATE TABLE scope_pivot(parent_id INTEGER, tag_id INTEGER)",
    "CREATE TABLE scope_bridges(id INTEGER PRIMARY KEY, parent_id INTEGER)",
    "CREATE TABLE scope_far(id INTEGER PRIMARY KEY, bridge_id INTEGER, active INTEGER, deleted_at TEXT)",
    "CREATE TABLE scope_images(id INTEGER PRIMARY KEY, imageable_type TEXT, imageable_id INTEGER, active INTEGER, deleted_at TEXT)",
    "INSERT INTO scope_parents VALUES(1,1),(2,3),(3,2),(4,5)",
    "INSERT INTO scope_children VALUES(1,1,1,NULL),(2,1,0,NULL),(3,2,1,NULL),(4,3,0,NULL),(5,4,1,'deleted'),(9,99,1,NULL)",
    "INSERT INTO scope_tags VALUES(1,1,NULL),(2,0,NULL),(3,1,'deleted'),(4,1,NULL)",
    "INSERT INTO scope_pivot VALUES(1,1),(1,2),(1,3),(2,4)",
    "INSERT INTO scope_bridges VALUES(11,1),(12,2),(13,3)",
    "INSERT INTO scope_far VALUES(1,11,1,NULL),(2,11,0,NULL),(3,12,1,NULL),(4,13,0,NULL),(5,11,1,'deleted')",
    "INSERT INTO scope_images VALUES(1,'parents',1,1,NULL),(2,'parents',1,0,NULL),(3,'parents',2,1,NULL),(4,'other',1,1,NULL),(5,'parents',1,1,'deleted'),(6,'children',2,1,NULL),(7,'children',1,1,NULL)",
  ])
    await connection.unsafe(sql);
  calls = 0;
  sqlLog = [];
  bindDatabaseConnection({
    async unsafe<R>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
      calls++;
      sqlLog.push(sql);
      return connection.unsafe<R>(sql, params);
    },
  });
});
afterEach(() => {
  connection.close();
  resetBoundDatabaseConnection();
  resetSqlDialect();
});

describe("related target model scopes", () => {
  test("lazy collections, singulars, aggregates and bindings retain visibility", async () => {
    const { Parent } = models();
    const parent = await Parent.findOrFail(1);
    expect((await parent.children().get()).map((r) => r.id)).toEqual([1]);
    expect(await parent.children().count()).toBe(1);
    expect(await parent.children().pluck("id")).toEqual([1]);
    expect(await parent.children().value("id")).toBe(1);
    expect((await parent.firstChild().get())?.id).toBe(1);
    expect((await parent.child().get())?.id).toBe(1);
    expect(await parent.children().where({ parent_id: 2 }).get()).toEqual([]);
    expect(await parent.children().where({ id: 1 }).where({ id: 2 }).get()).toEqual([]);
    expect(await parent.rejected().get()).toEqual([]);
    expect(await (await Parent.findOrFail(3)).child().get()).toBeNull();
  });
  test("pivot and through reads apply target scopes, operators and soft deletes", async () => {
    const { Parent } = models();
    const parent = await Parent.findOrFail(1);
    expect((await parent.tags().get()).map((r) => r.id)).toEqual([1]);
    expect(await parent.tags().count()).toBe(1);
    expect(await parent.tags().where({ active: 0 }).count()).toBe(0);
    expect(
      (
        await parent
          .far()
          .where({ id: { gte: 1 } })
          .get()
      ).map((r) => r.id),
    ).toEqual([1]);
    expect(await parent.far().where({ active: 0 }).count()).toBe(0);
  });
  test("eager collection families batch across parents with one query per relation", async () => {
    const { Parent } = models();
    calls = 0;
    const rows = await Parent.where({ id: [1, 2] })
      .with("children", "tags", "far", "images")
      .get();
    expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("children")?.map((c) => c.id))).toEqual(
      [[1], [3]],
    );
    expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("tags")?.map((c) => c.id))).toEqual([
      [1],
      [4],
    ]);
    expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("far")?.map((c) => c.id))).toEqual([
      [1],
      [3],
    ]);
    expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("images")?.map((c) => c.id))).toEqual([
      [1],
      [3],
    ]);
    expect(calls).toBe(6); // Parent + children + pivot/targets + through + images.
  });
  test("eager singulars are per parent and related filters are not discarded", async () => {
    const { Parent } = models();
    const rows = await Parent.where({ id: [1, 2, 3, 4] })
      .with("firstChild", "child", "image", "filtered", "rejected")
      .get();
    expect(rows.map((r) => r.loaded<{ id: unknown }>("firstChild")?.id)).toEqual([
      1,
      3,
      undefined,
      undefined,
    ]);
    expect(rows.map((r) => r.loaded<{ id: unknown }>("child")?.id)).toEqual([
      1,
      3,
      undefined,
      undefined,
    ]);
    expect(rows.map((r) => r.loaded<{ id: unknown }>("image")?.id)).toEqual([
      1,
      3,
      undefined,
      undefined,
    ]);
    expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("filtered")?.map((c) => c.id))).toEqual(
      [[1], [], [], []],
    );
    expect(rows.every((r) => r.loaded<unknown[]>("rejected")?.length === 0)).toBe(true);
  });
  test("existence, absence and projected counts use the same scoped rows", async () => {
    const { Parent } = models();
    for (const name of ["children", "firstChild", "child", "tags", "far", "images", "image"]) {
      expect((await Parent.query().whereHas(name).get()).map((r) => r.id)).toEqual([1, 2]);
      expect((await Parent.query().doesntHave(name).get()).map((r) => r.id)).toEqual([3, 4]);
      const rows = await Parent.query().withCount(name, "visible").get();
      expect(rows.map((r) => r.toObject()["visible"])).toEqual([1, 1, 0, 0]);
    }
    expect(await Parent.query().whereHas("rejected").get()).toEqual([]);
  });
  test("morph-to batches each type and excludes hidden or unknown targets", async () => {
    const { Image } = models();
    expect(await (await Image.findOrFail(6)).imageable().get()).toBeNull();
    expect((await (await Image.findOrFail(7)).imageable().get())?.id).toBe(1);
    calls = 0;
    const rows = await Image.with("imageable").get();
    expect(rows.map((r) => r.loaded<{ id: number }>("imageable")?.id)).toEqual([
      1,
      2,
      undefined,
      undefined,
      1,
    ]);
    expect(calls).toBe(3); // Images + one target query per known type.
    expect((await Image.query().whereHas("imageable").get()).map((r) => r.id)).toEqual([1, 3, 7]);
    expect(
      (await Image.query().withCount("imageable", "visible").get()).map(
        (r) => r.toObject()["visible"],
      ),
    ).toEqual([1, 1, 0, 0, 1]);
  });
  test("dialect placeholders preserve through and polymorphic parameter order", async () => {
    for (const dialect of ["pgsql", "mysql", "sqlite"] as const) {
      useSqlDialect(dialect);
      const { Parent, Image } = models();
      sqlLog = [];
      const parent = await Parent.findOrFail(1);
      expect((await parent.tags().get()).map((row) => row.id)).toEqual([1]);
      expect(
        (
          await Parent.query()
            .where({ id: [1, 2] })
            .with("far")
            .get()
        ).map((row) => row.loaded<Array<{ id: unknown }>>("far")?.map((item) => item.id)),
      ).toEqual([[1], [3]]);
      expect(
        (
          await Parent.query()
            .where({ id: 1 })
            .whereHas("far", (query) => query.where?.({ id: { gte: 1 } }))
            .get()
        ).map((row) => row.id),
      ).toEqual([1]);
      expect(
        (
          await Image.query()
            .where({ id: { gt: 0 } })
            .withCount("imageable", "visible")
            .whereHas("imageable")
            .get()
        ).map((row) => [row.id, row.toObject()["visible"]]),
      ).toEqual([
        [1, 1],
        [3, 1],
        [7, 1],
      ]);
      if (dialect !== "pgsql") expect(sqlLog.some((sql) => /\$\d+/.test(sql))).toBe(false);
    }
  });
  test("OR scopes cannot escape relation keys in lazy, eager or existence queries", async () => {
    class Either extends defineModel(children) {
      static override boot() {
        this.addGlobalScope<C, "id">("either", (query) =>
          query.where({ id: 1 }).orWhere({ id: 3 }),
        );
      }
    }
    class Holder extends defineModel(parents) {
      children() {
        return this.hasMany<C, "id">(Either, "parent_id");
      }
    }
    const first = await Holder.findOrFail(1);
    expect((await first.children().get()).map((row) => row.id)).toEqual([1]);
    expect(await first.children().where({ parent_id: 2 }).get()).toEqual([]);
    const eager = await Holder.where({ id: [1, 2] })
      .with("children")
      .get();
    expect(
      eager.map((row) => row.loaded<Array<{ id: unknown }>>("children")?.map((item) => item.id)),
    ).toEqual([[1], [3]]);
    expect(
      (
        await Holder.query()
          .whereHas("children", (query) => query.where?.({ parent_id: 2 }))
          .get()
      ).map((row) => row.id),
    ).toEqual([2]);
  });
  test("scope joins retain predicates and ambiguous existence joins fail closed", async () => {
    await connection.unsafe("CREATE TABLE scope_visibility(child_id INTEGER)");
    await connection.unsafe("INSERT INTO scope_visibility VALUES(1)");
    class Joined extends defineModel(children) {
      static override boot() {
        this.addGlobalScope<C, "id">("visible", (query) =>
          query.join("scope_children.id", "scope_visibility.child_id").where({ active: 1 }),
        );
      }
    }
    class Ambiguous extends defineModel(children) {
      static override boot() {
        this.addGlobalScope<C, "id">("visible", (query) =>
          query.join("scope_children.parent_id", "scope_parents.id"),
        );
      }
    }
    class Bridge extends defineModel(bridges) {}
    class ThroughConflict extends defineModel(far) {
      static override boot() {
        this.addGlobalScope<F, "id">("visible", (query) =>
          query.join("scope_far.bridge_id", "scope_bridges.id"),
        );
      }
    }
    class Holder extends defineModel(parents) {
      throughConflict() {
        return this.hasManyThrough<F, B, "id", "id">(
          ThroughConflict,
          Bridge,
          "parent_id",
          "bridge_id",
        );
      }
      children() {
        return this.hasMany<C, "id">(Joined, "parent_id");
      }
      ambiguous() {
        return this.hasMany<C, "id">(Ambiguous, "parent_id");
      }
    }
    expect((await (await Holder.findOrFail(1)).children().get()).map((row) => row.id)).toEqual([1]);
    const eager = await Holder.where({ id: [1, 2] })
      .with("children")
      .get();
    expect(
      eager.map((row) => row.loaded<Array<{ id: unknown }>>("children")?.map((item) => item.id)),
    ).toEqual([[1], []]);
    expect((await Holder.query().whereHas("children").get()).map((row) => row.id)).toEqual([1]);
    expect(
      (await Holder.query().withCount("children", "visible").get()).map(
        (row) => row.toObject()["visible"],
      ),
    ).toEqual([1, 0, 0, 0]);
    expect(() => Holder.query().whereHas("ambiguous")).toThrow("reserved relation table");
    expect(() => Holder.query().whereHas("throughConflict")).toThrow("reserved relation table");
    await expect((await Holder.findOrFail(1)).throughConflict().get()).rejects.toThrow(
      "through table twice",
    );
    await expect(Holder.with("throughConflict").get()).rejects.toThrow("through table twice");
  });
});
