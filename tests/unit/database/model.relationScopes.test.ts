import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  defineModel,
  defineRepository,
  type ModelDefinition,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

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

class ChildEntity extends Model<C, "id"> {}
class TagEntity extends Model<T, "id"> {}
class BridgeEntity extends Model<B, "id"> {}
class FarEntity extends Model<F, "id"> {}
class ImageEntity extends Model<I, "id"> {
  imageable() {
    return this.morphTo({ parents: ParentDefinition, children: ChildDefinition }, "imageable");
  }
}
class ParentEntity extends Model<P, "id"> {
  children() {
    return this.hasMany(ChildDefinition, "parent_id");
  }
  firstChild() {
    return this.hasOne(ChildDefinition, "parent_id");
  }
  child() {
    return this.belongsTo(ChildDefinition, "child_id");
  }
  tags() {
    return this.belongsToMany(TagDefinition, "scope_pivot", "parent_id", "tag_id");
  }
  far() {
    return this.hasManyThrough(FarDefinition, BridgeDefinition, "parent_id", "bridge_id");
  }
  images() {
    return this.morphMany(ImageDefinition, "imageable");
  }
  image() {
    return this.morphOne(ImageDefinition, "imageable");
  }
  filtered() {
    return this.children().where({ id: 1 });
  }
  rejected() {
    return this.children().where({ active: 0 });
  }
}
class HolderEntity extends Model<P, "id"> {
  children() {
    return this.hasMany(EitherDefinition, "parent_id");
  }
}
class JoinedHolderEntity extends Model<P, "id"> {
  throughConflict() {
    return this.hasManyThrough(
      ThroughConflictDefinition,
      BridgeDefinition,
      "parent_id",
      "bridge_id",
    );
  }
  children() {
    return this.hasMany(JoinedDefinition, "parent_id");
  }
  ambiguous() {
    return this.hasMany(AmbiguousDefinition, "parent_id");
  }
}
const ParentsRepository = defineRepository({
  name: "ParentsRepository",
  table: parents,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const ChildrenRepository = defineRepository({
  name: "ChildrenRepository",
  table: children,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const TagsRepository = defineRepository({
  name: "TagsRepository",
  table: tags,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const BridgesRepository = defineRepository({
  name: "BridgesRepository",
  table: bridges,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const FarRepository = defineRepository({
  name: "FarRepository",
  table: far,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const ImagesRepository = defineRepository({
  name: "ImagesRepository",
  table: images,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const ParentDefinition: ModelDefinition<P, "id", ParentEntity> = defineModel({
  name: "parents",
  repository: ParentsRepository,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new ParentEntity(state, binding),
});
const ChildDefinition: ModelDefinition<C, "id", ChildEntity> = defineModel({
  name: "children",
  repository: ChildrenRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.where({ active: 1 })],
  construct: (state, binding) => new ChildEntity(state, binding),
});
const TagDefinition: ModelDefinition<T, "id", TagEntity> = defineModel({
  name: "tags",
  repository: TagsRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.where({ active: 1 })],
  construct: (state, binding) => new TagEntity(state, binding),
});
const BridgeDefinition: ModelDefinition<B, "id", BridgeEntity> = defineModel({
  name: "bridges",
  repository: BridgesRepository,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new BridgeEntity(state, binding),
});
const FarDefinition: ModelDefinition<F, "id", FarEntity> = defineModel({
  name: "far",
  repository: FarRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.where({ active: 1 })],
  construct: (state, binding) => new FarEntity(state, binding),
});
const ImageDefinition: ModelDefinition<I, "id", ImageEntity> = defineModel({
  name: "images",
  repository: ImagesRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.where({ active: 1 })],
  construct: (state, binding) => new ImageEntity(state, binding),
});
const EitherDefinition: ModelDefinition<C, "id", ChildEntity> = defineModel({
  name: "Either",
  repository: ChildrenRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.where({ id: 1 }).orWhere({ id: 3 })],
  construct: (state, binding) => new ChildEntity(state, binding),
});
const HolderDefinition: ModelDefinition<P, "id", HolderEntity> = defineModel({
  name: "Holder",
  repository: ParentsRepository,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new HolderEntity(state, binding),
});
const JoinedDefinition: ModelDefinition<C, "id", ChildEntity> = defineModel({
  name: "Joined",
  repository: ChildrenRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.join("scope_children.id", "scope_visibility.child_id").where({ active: 1 })],
  construct: (state, binding) => new ChildEntity(state, binding),
});
const AmbiguousDefinition: ModelDefinition<C, "id", ChildEntity> = defineModel({
  name: "Ambiguous",
  repository: ChildrenRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.join("scope_children.parent_id", "scope_parents.id")],
  construct: (state, binding) => new ChildEntity(state, binding),
});
const ThroughConflictDefinition: ModelDefinition<F, "id", FarEntity> = defineModel({
  name: "ThroughConflict",
  repository: FarRepository,
  dependencies: [],
  attributes: { timestamps: false },
  scopes: [(q) => q.join("scope_far.bridge_id", "scope_bridges.id")],
  construct: (state, binding) => new FarEntity(state, binding),
});
const JoinedHolderDefinition: ModelDefinition<P, "id", JoinedHolderEntity> = defineModel({
  name: "JoinedHolder",
  repository: ParentsRepository,
  dependencies: [],
  attributes: { timestamps: false },
  construct: (state, binding) => new JoinedHolderEntity(state, binding),
});

interface Trace {
  calls: number;
  sqlLog: string[];
}
function graph(database: DatabaseSession, trace: Trace) {
  return {
    database,
    trace,
    Parent: database.model(ParentDefinition),
    Child: database.model(ChildDefinition),
    Tag: database.model(TagDefinition),
    Bridge: database.model(BridgeDefinition),
    Far: database.model(FarDefinition),
    Image: database.model(ImageDefinition),
    Either: database.model(EitherDefinition),
    Holder: database.model(HolderDefinition),
    Joined: database.model(JoinedDefinition),
    Ambiguous: database.model(AmbiguousDefinition),
    ThroughConflict: database.model(ThroughConflictDefinition),
    JoinedHolder: database.model(JoinedHolderDefinition),
  };
}
async function withModels(
  work: (models: ReturnType<typeof graph>) => Promise<void>,
  driver?: "pgsql" | "mysql" | "sqlite",
) {
  const connection = driver ? createSqliteConnection(":memory:") : undefined;
  const trace: Trace = { calls: 0, sqlLog: [] };
  try {
    await withBoundDatabase(
      {
        definition: {
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          repositories: [
            ParentsRepository,
            ChildrenRepository,
            TagsRepository,
            BridgesRepository,
            FarRepository,
            ImagesRepository,
          ],
          models: [
            ParentDefinition,
            ChildDefinition,
            TagDefinition,
            BridgeDefinition,
            FarDefinition,
            ImageDefinition,
            EitherDefinition,
            HolderDefinition,
            JoinedDefinition,
            AmbiguousDefinition,
            ThroughConflictDefinition,
            JoinedHolderDefinition,
          ],
        },
        connection,
        driver,
        observe: (statement) => {
          trace.calls++;
          trace.sqlLog.push(statement.text);
        },
      },
      async (database) => {
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
          await database.execute({ text: sql, params: [] });

        trace.calls = 0;
        trace.sqlLog = [];
        await work(graph(database, trace));
      },
    );
  } finally {
    await connection?.close();
  }
}
describe("related target model scopes", () => {
  test("lazy collections, singulars, aggregates and bindings retain visibility", async () => {
    await withModels(async ({ Parent }) => {
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
  });
  test("pivot and through reads apply target scopes, operators and soft deletes", async () => {
    await withModels(async ({ Parent }) => {
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
  });
  test("eager collection families batch across parents with one query per relation", async () => {
    await withModels(async ({ Parent, trace }) => {
      trace.calls = 0;
      const rows = await Parent.query()
        .where({ id: [1, 2] })
        .with("children", "tags", "far", "images")
        .get();
      expect(
        rows.map((r) => r.loaded<Array<{ id: unknown }>>("children")?.map((c) => c.id)),
      ).toEqual([[1], [3]]);
      expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("tags")?.map((c) => c.id))).toEqual([
        [1],
        [4],
      ]);
      expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("far")?.map((c) => c.id))).toEqual([
        [1],
        [3],
      ]);
      expect(rows.map((r) => r.loaded<Array<{ id: unknown }>>("images")?.map((c) => c.id))).toEqual(
        [[1], [3]],
      );
      expect(trace.calls).toBe(6); // Parent + children + pivot/targets + through + images.
    });
  });
  test("eager singulars are per parent and related filters are not discarded", async () => {
    await withModels(async ({ Parent }) => {
      const rows = await Parent.query()
        .where({ id: [1, 2, 3, 4] })
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
      expect(
        rows.map((r) => r.loaded<Array<{ id: unknown }>>("filtered")?.map((c) => c.id)),
      ).toEqual([[1], [], [], []]);
      expect(rows.every((r) => r.loaded<unknown[]>("rejected")?.length === 0)).toBe(true);
    });
  });
  test("existence, absence and projected counts use the same scoped rows", async () => {
    await withModels(async ({ Parent }) => {
      for (const name of ["children", "firstChild", "child", "tags", "far", "images", "image"]) {
        expect((await Parent.query().whereHas(name).get()).map((r) => r.id)).toEqual([1, 2]);
        expect((await Parent.query().doesntHave(name).get()).map((r) => r.id)).toEqual([3, 4]);
        const rows = await Parent.query().withCount(name, "visible").get();
        expect(rows.map((r) => r.toObject().visible)).toEqual([1, 1, 0, 0]);
      }
      expect(await Parent.query().whereHas("rejected").get()).toEqual([]);
    });
  });
  test("morph-to batches each type and excludes hidden or unknown targets", async () => {
    await withModels(async ({ Image, trace }) => {
      expect(await (await Image.findOrFail(6)).imageable().get()).toBeNull();
      expect((await (await Image.findOrFail(7)).imageable().get())?.id).toBe(1);
      trace.calls = 0;
      const rows = await Image.query().with("imageable").get();
      expect(rows.map((r) => r.loaded<{ id: number }>("imageable")?.id)).toEqual([
        1,
        2,
        undefined,
        undefined,
        1,
      ]);
      expect(trace.calls).toBe(3); // Images + one target query per known type.
      expect((await Image.query().whereHas("imageable").get()).map((r) => r.id)).toEqual([1, 3, 7]);
      expect(
        (await Image.query().withCount("imageable", "visible").get()).map(
          (r) => r.toObject().visible,
        ),
      ).toEqual([1, 1, 0, 0, 1]);
    });
  });
  test("dialect placeholders preserve through and polymorphic parameter order", async () => {
    for (const dialect of ["pgsql", "mysql", "sqlite"] as const) {
      await withModels(async ({ Parent, Image, trace }) => {
        trace.sqlLog = [];
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
          ).map((row) => [row.id, row.toObject().visible]),
        ).toEqual([
          [1, 1],
          [3, 1],
          [7, 1],
        ]);
        if (dialect !== "pgsql") expect(trace.sqlLog.some((sql) => /\$\d+/.test(sql))).toBe(false);
      }, dialect);
    }
  });
  test("OR scopes cannot escape relation keys in lazy, eager or existence queries", async () => {
    await withModels(async ({ Holder }) => {
      const first = await Holder.findOrFail(1);
      expect((await first.children().get()).map((row) => row.id)).toEqual([1]);
      expect(await first.children().where({ parent_id: 2 }).get()).toEqual([]);
      const eager = await Holder.query()
        .where({ id: [1, 2] })
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
  });
  test("scope joins retain predicates and ambiguous existence joins fail closed", async () => {
    await withModels(async ({ JoinedHolder, database }) => {
      await database.execute({
        text: "CREATE TABLE scope_visibility(child_id INTEGER)",
        params: [],
      });
      await database.execute({ text: "INSERT INTO scope_visibility VALUES(1)", params: [] });

      expect(
        (await (await JoinedHolder.findOrFail(1)).children().get()).map((row) => row.id),
      ).toEqual([1]);
      const eager = await JoinedHolder.query()
        .where({ id: [1, 2] })
        .with("children")
        .get();
      expect(
        eager.map((row) => row.loaded<Array<{ id: unknown }>>("children")?.map((item) => item.id)),
      ).toEqual([[1], []]);
      expect((await JoinedHolder.query().whereHas("children").get()).map((row) => row.id)).toEqual([
        1,
      ]);
      expect(
        (await JoinedHolder.query().withCount("children", "visible").get()).map(
          (row) => row.toObject().visible,
        ),
      ).toEqual([1, 0, 0, 0]);
      expect(() => JoinedHolder.query().whereHas("ambiguous")).toThrow("reserved relation table");
      expect(() => JoinedHolder.query().whereHas("throughConflict")).toThrow(
        "reserved relation table",
      );
      await expect((await JoinedHolder.findOrFail(1)).throughConflict().get()).rejects.toThrow(
        "through table twice",
      );
      await expect(JoinedHolder.query().with("throughConflict").get()).rejects.toThrow(
        "through table twice",
      );
    });
  });
});
