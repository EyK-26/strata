/** Installed relation-loader consumer; all application SQL is compiled by the public ORM. */
import assert from "node:assert/strict";
import type { InitializedAppContext } from "@getstrata/bootstrap/context";
import { BaseRepository, type DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { belongsToMany, hasManyThrough } from "@getstrata/core/database/relationships";
import { defineTable } from "@getstrata/core/database/table";
import type { QueryOptions, QueryWhere } from "@getstrata/core/database/types";

type Parent = { id: number; scope: string; label: string };
type Bridge = { id: number; parent_id: number };
type Far = {
  id: number;
  bridge_id: number;
  tenant_id: number;
  name: string;
  deleted_at: Date | null;
};
type Pivot = { id: number; parent_id: number; far_id: number };
const parentTable = defineTable<Parent, "id">({
  name: "rebinding_items",
  primaryKey: "id",
  columns: ["id", "scope", "label"],
});
const bridgeTable = defineTable<Bridge, "id">({
  name: "relation_bridges",
  primaryKey: "id",
  columns: ["id", "parent_id"],
});
const farTable = defineTable<Far, "id">({
  name: "relation_far",
  primaryKey: "id",
  columns: ["id", "bridge_id", "tenant_id", "name", "deleted_at"],
  softDeletes: true,
});
const pivotTable = defineTable<Pivot, "id">({
  name: "relation_pivot",
  primaryKey: "id",
  columns: ["id", "parent_id", "far_id"],
});

class ScopedFarRepository extends BaseRepository<Far, "id"> {
  readonly #tenantId: number;

  constructor(
    connection: DatabaseConnection,
    tenantId: number,
    readonly reads: QueryWhere<Far>[] = [],
  ) {
    super(farTable, connection);
    this.#tenantId = tenantId;
  }

  protected override cloneWithConnection(connection: DatabaseConnection): this {
    return new ScopedFarRepository(connection, this.#tenantId, this.reads) as this;
  }

  protected override findWhere(
    where: QueryWhere<Far>,
    options: Omit<QueryOptions<Far>, "where"> = {},
  ): Promise<Far[]> {
    this.reads.push(where);
    return super.findWhere({ ...where, tenant_id: this.#tenantId }, options);
  }
}

const application: {
  createApp(options: { migrate: false }): Promise<{ context: InitializedAppContext }>;
} = await import(new URL("../bootstrap/createApp.ts", import.meta.url).href);
const database: { closeDatabase(): Promise<void> } = await import(
  new URL("../bootstrap/database.ts", import.meta.url).href
);
const app = await application.createApp({ migrate: false });
try {
  const parents = new BaseRepository(parentTable);
  const bridges = new BaseRepository(bridgeTable);
  const far = new BaseRepository(farTable);
  const pivots = new BaseRepository(pivotTable);
  const first = await parents.create({ scope: "relation-query", label: "first parent" });
  const second = await parents.create({ scope: "relation-query", label: "second parent" });
  const bridge = await bridges.create({ parent_id: first.id });
  const visible = await far.create({
    bridge_id: bridge.id,
    tenant_id: 7,
    name: "visible",
    deleted_at: null,
  });
  const hidden = await far.create({
    bridge_id: bridge.id,
    tenant_id: 8,
    name: "other tenant",
    deleted_at: null,
  });
  const deleted = await far.create({
    bridge_id: bridge.id,
    tenant_id: 7,
    name: "deleted",
    deleted_at: null,
  });
  assert.equal(await far.softDeleteById(deleted.id), true);

  const through = hasManyThrough<Parent, Far, "id", "parent_id", "id", "bridge_id">({
    name: "through",
    localKey: "id",
    throughTable: "relation_bridges",
    firstKey: "parent_id",
    secondLocalKey: "id",
    secondKey: "bridge_id",
    throughParentKey: "source_parent",
  });
  const grouped = await far.loadHasManyThroughForParents([first, first, second], through, {
    where: { tenant_id: 7 },
    whereNodes: [{ kind: "and", where: { name: "visible" } }],
  });
  assert.deepEqual(
    grouped.get(first.id)?.map((row) => Number(row.id)),
    [Number(visible.id)],
  );
  assert.deepEqual(grouped.get(second.id), []);
  assert.equal(Reflect.has(grouped.get(first.id)?.[0] ?? {}, "source_parent"), false);
  assert.deepEqual(await far.loadHasManyThroughForParents([], through), new Map());
  const trashed = await far.loadHasManyThroughForParents([first], through, {
    where: { tenant_id: 7 },
    onlyTrashed: true,
  });
  assert.deepEqual(
    trashed.get(first.id)?.map((row) => Number(row.id)),
    [Number(deleted.id)],
  );
  await assert.rejects(
    far.loadHasManyThroughForParents([first], through, {
      joins: [{ type: "inner", table: "relation_bridges", on: [] }],
    }),
    /joins the through table twice/,
  );

  await pivots.create({ parent_id: first.id, far_id: visible.id });
  await pivots.create({ parent_id: first.id, far_id: hidden.id });
  await pivots.create({ parent_id: first.id, far_id: deleted.id });
  const pivot = belongsToMany<Parent, Far, Pivot, "id", "id", "parent_id", "far_id">({
    name: "pivot",
    pivotTable: "relation_pivot",
    parentKey: "id",
    relatedKey: "id",
    foreignPivotKey: "parent_id",
    relatedPivotKey: "far_id",
  });
  const scoped = new ScopedFarRepository(far.getConnection(), 7);
  const originalConnection = scoped.getConnection();
  const loaded = await far.loadBelongsToManyForParents([first, first, second], pivot, scoped);
  assert.deepEqual(
    loaded.get(first.id)?.map((row) => Number(row.id)),
    [Number(visible.id)],
  );
  assert.deepEqual(loaded.get(second.id), []);
  assert.equal(scoped.reads.length, 1);
  assert.equal(scoped.getConnection(), originalConnection);
  const empty = await far.loadBelongsToManyForParents([second], pivot, scoped);
  assert.deepEqual(empty.get(second.id), []);
  assert.equal(scoped.reads.length, 1);
  assert.deepEqual(await far.loadBelongsToManyForParents([], pivot, scoped), new Map());
  assert.equal(scoped.reads.length, 1);
  console.log(
    "PASS installed through/pivot relations, scoped predicates, soft deletes and protected repository dispatch",
  );
} finally {
  // Generated CLI entrypoints close their separately owned database after provider disposal.
  try {
    await app.context.dispose();
  } finally {
    await database.closeDatabase();
  }
}
