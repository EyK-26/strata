import { describe, expect, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import type { ModelObserver } from "@getstrata/core/database/definitions";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model, ModelQuery } from "@getstrata/core/database/model";
import {
  belongsTo,
  belongsToMany,
  hasMany,
  hasManyThrough,
  morphMany,
  morphOne,
  morphTo,
} from "@getstrata/core/database/relationships";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type GraphRow = Record<string, unknown>;

type Row = { id: number; scope: string; label: string };
const table = defineTable<Row, "id">({
  name: "query_contract_rows",
  primaryKey: "id",
  columns: ["id", "scope", "label"],
});
class EntryEntity extends Model<Row, "id"> {
  label() {
    return this.get("label");
  }
}
class NodeEntity extends Model<GraphRow, "id"> {}
const graph = defineTable<GraphRow, "id">({
  name: "query_graph_nodes",
  primaryKey: "id",
  columns: ["id", "parent_id", "owner_type", "owner_id", "deleted_at"],
  softDeletes: true,
});
const entries = defineRepository({
  name: "entries",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const nodes = defineRepository({
  name: "nodes",
  table: graph,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const Observer = createServiceToken<ModelObserver<EntryEntity>>("retrieved-entry");
const EntryDefinition = defineModel({
  name: "Entry",
  repository: entries,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new EntryEntity(state, binding),
});
const VisibleDefinition = defineModel({
  name: "VisibleEntry",
  repository: entries,
  dependencies: [],
  attributes: {},
  observers: [Observer],
  scopes: [(query) => query.where({ scope: "visible" })],
  construct: (state, binding) => new EntryEntity(state, binding),
});
const NodeDefinition = defineModel({
  name: "Node",
  repository: nodes,
  dependencies: [],
  attributes: {},
  construct: (state, binding) => new NodeEntity(state, binding),
});
async function fixture(
  work: (db: DatabaseSession) => Promise<void>,
  observer: ModelObserver<EntryEntity> = {},
) {
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [entries, nodes],
        models: [EntryDefinition, VisibleDefinition, NodeDefinition],
      },
      services: [valueService(Observer, observer)],
    },
    async (db) => {
      await db.execute({
        text: "CREATE TABLE query_contract_rows (id INTEGER PRIMARY KEY, scope TEXT, label TEXT)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO query_contract_rows VALUES (1,'visible','first'),(2,'hidden','second'),(3,'visible','third')",
        params: [],
      });
      await work(db);
    },
  );
}

describe("public Model query and projection contracts", () => {
  test("projections remain plain records while full query pages retain subclass identity and retrieved hooks", async () => {
    const retrieved: number[] = [];
    await fixture(
      async (db) => {
        const Entry = db.model(VisibleDefinition);
        const orderBy = [{ column: "id", direction: "asc" }] as const;
        const projected = await Entry.query()
          .select("label")
          .keysetPaginate({ perPage: 1, orderBy });
        expect(projected.data).toEqual([{ label: "first" }]);
        expect(projected.data[0]).not.toHaveProperty("save");
        expect(projected.meta.next_cursor).toBeTruthy();
        expect(retrieved).toEqual([]);
        const second = await Entry.query()
          .select("label")
          .keysetPaginate({
            perPage: 1,
            orderBy,
            cursor: projected.meta.next_cursor ?? undefined,
          });
        expect(second.data).toEqual([{ label: "third" }]);
        const models = await Entry.query().keysetPaginate({ perPage: 1, orderBy });
        expect(models.data[0]).toBeInstanceOf(EntryEntity);
        expect(models.data[0]?.label()).toBe("first");
        expect(retrieved).toEqual([1]);
        expect(await Entry.where({ id: 99 }).select("label").first()).toBeNull();
      },
      { retrieved: (model) => retrieved.push(Number(model.id)) },
    );
  });

  test("the exported query constructor uses the supplied query and preserves thenable fulfillment and rejection", async () => {
    await fixture(async (db) => {
      const Entry = db.model(EntryDefinition);
      const query = new ModelQuery<EntryEntity>(Entry, Entry.query().query);
      expect(query).toBeInstanceOf(ModelQuery);
      const rows = await query.where({ id: 3 });
      expect(Array.isArray(rows)).toBe(true);
      if (!Array.isArray(rows)) throw new Error("Thenable query did not return an array.");
      expect(rows[0]).toBeInstanceOf(EntryEntity);
      expect(rows[0]?.get("label")).toBe("third");
    });
    await expect(
      fixture(async (db) => {
        const pending = db.model(EntryDefinition).query();
        await db.execute({ text: "DROP TABLE query_contract_rows", params: [] });
        await Promise.resolve(pending);
      }),
    ).rejects.toThrow();
  });

  test("missing records preserve null, default errors and caller-owned error identity", async () => {
    await fixture(async (db) => {
      const Entry = db.model(EntryDefinition);
      expect(await Entry.query().find(99)).toBeNull();
      expect((await Entry.query().findOrFail(1)).get("label")).toBe("first");
    });
    await expect(
      fixture(async (db) => {
        await db.model(EntryDefinition).query().findOrFail(99);
      }),
    ).rejects.toThrow("Entry 99 not found.");
    const error = new Error("owned missing record");
    await expect(
      fixture(async (db) => {
        await db
          .model(EntryDefinition)
          .query()
          .findOrFail(99, () => error);
      }),
    ).rejects.toBe(error);
  });

  test("unknown relation names fail at composition instead of silently dropping constraints", async () => {
    await fixture(async (db) => {
      const Entry = db.model(EntryDefinition);
      for (const compose of [
        () => Entry.query().with("missing"),
        () => Entry.query().withCount("missing"),
        () => Entry.query().has("missing"),
        () => Entry.query().whereDoesntHave("missing"),
      ]) {
        expect(compose).toThrow("Entry has no relation method missing().");
      }
    });
  });

  test("native query filters, offsets and limits compose without changing model hydration", async () => {
    await fixture(async (db) => {
      const Entry = db.model(EntryDefinition);
      expect(await Entry.query().whereNull("scope").get()).toEqual([]);
      const rows = await Entry.query()
        .whereIn("id", [1, 3])
        .orderBy({ id: "asc" })
        .offset(1)
        .limit(1)
        .get();
      expect(rows.map((row) => row.toObject())).toEqual([
        { id: 3, scope: "visible", label: "third" },
      ]);
      expect(rows[0]).toBeInstanceOf(EntryEntity);
    });
  });

  test("explicit relation maps attach native SQL results and retain soft-delete selection", async () => {
    await fixture(async (db) => {
      await db.execute({
        text: "CREATE TABLE query_graph_nodes (id INTEGER PRIMARY KEY, parent_id INTEGER, owner_type TEXT, owner_id INTEGER, deleted_at TEXT)",
        params: [],
      });
      await db.execute({
        text: "CREATE TABLE query_graph_edges (id INTEGER PRIMARY KEY, parent_id INTEGER)",
        params: [],
      });
      await db.execute({
        text: "CREATE TABLE query_graph_pivot (parent_id INTEGER, node_id INTEGER)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO query_graph_nodes VALUES (1,3,'node',2,NULL),(2,1,'node',1,NULL),(3,20,'node',20,NULL),(4,1,'node',1,'2026-01-01')",
        params: [],
      });
      await db.execute({ text: "INSERT INTO query_graph_edges VALUES (20,1)", params: [] });
      await db.execute({ text: "INSERT INTO query_graph_pivot VALUES (1,3)", params: [] });
      // This legacy API accepts dynamic record/alias maps. Keep that existing public
      // boundary explicit rather than casting concrete repositories to erased ones.
      const Node = db.model(NodeDefinition);
      const repository = db.repository(nodes);
      const root = () => Node.where({ id: 1 });
      const checks = [
        [
          root().withHasMany(
            "related",
            hasMany<GraphRow, GraphRow>({
              name: "children",
              localKey: "id",
              foreignKey: "parent_id",
            }),
            repository,
          ),
          [expect.objectContaining({ id: 2 })],
        ],
        [
          root().withBelongsTo(
            "related",
            belongsTo<GraphRow, GraphRow>({
              name: "parent",
              foreignKey: "parent_id",
              ownerKey: "id",
            }),
            repository,
          ),
          expect.objectContaining({ id: 3 }),
        ],
        [
          root().withBelongsToMany(
            "related",
            belongsToMany<GraphRow, GraphRow, GraphRow>({
              name: "linked",
              pivotTable: "query_graph_pivot",
              parentKey: "id",
              relatedKey: "id",
              foreignPivotKey: "parent_id",
              relatedPivotKey: "node_id",
            }),
            repository,
          ),
          [expect.objectContaining({ id: 3 })],
        ],
        [
          root().withMorphMany(
            "related",
            morphMany<GraphRow, GraphRow>({
              name: "owned",
              localKey: "id",
              morphTypeKey: "owner_type",
              morphIdKey: "owner_id",
              morphType: "node",
            }),
            repository,
          ),
          [expect.objectContaining({ id: 2 })],
        ],
        [
          root().withMorphOne(
            "related",
            morphOne<GraphRow, GraphRow>({
              name: "ownedOne",
              localKey: "id",
              morphTypeKey: "owner_type",
              morphIdKey: "owner_id",
              morphType: "node",
            }),
            repository,
          ),
          expect.objectContaining({ id: 2 }),
        ],
        [
          root().withMorphTo(
            "related",
            morphTo<GraphRow>({
              name: "owner",
              morphTypeKey: "owner_type",
              morphIdKey: "owner_id",
            }),
            new Map([["node", repository]]),
          ),
          expect.objectContaining({ id: 2 }),
        ],
        [
          root().withHasManyThrough(
            "related",
            hasManyThrough<GraphRow, GraphRow>({
              name: "far",
              throughTable: "query_graph_edges",
              localKey: "id",
              firstKey: "parent_id",
              secondLocalKey: "id",
              secondKey: "parent_id",
            }),
            repository,
          ),
          [expect.objectContaining({ id: 3 })],
        ],
      ] as const;
      for (const [query, expected] of checks) {
        const rows = await query.get();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toBeInstanceOf(NodeEntity);
        expect(rows[0]?.get("related")).toEqual(expected);
      }
      expect((await Node.query().orderBy({ id: "asc" }).get()).map((row) => row.id)).toEqual([
        1, 2, 3,
      ]);
      expect(
        (await Node.query().withTrashed().orderBy({ id: "asc" }).get()).map((row) => row.id),
      ).toEqual([1, 2, 3, 4]);
      expect((await Node.query().onlyTrashed().get()).map((row) => row.id)).toEqual([4]);
    });
  });
});
