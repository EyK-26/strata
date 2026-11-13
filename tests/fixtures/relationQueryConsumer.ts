/** Installed relation-loader consumer; all application SQL is compiled by the public ORM. */
import assert from "node:assert/strict";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { defineRepository, type RepositoryBinding } from "@getstrata/core/database/definitions";
import { belongsToMany, hasManyThrough } from "@getstrata/core/database/relationships";
import type { DatabaseConnectionOptions } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import type { QueryOptions, QueryWhere } from "@getstrata/core/database/types";
import { createApplication } from "@getstrata/core/runtime/application";

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
    binding: RepositoryBinding<Far, "id">,
    tenantId: number,
    readonly reads: QueryWhere<Far>[] = [],
  ) {
    super(binding);
    this.#tenantId = tenantId;
  }

  applyScope(options: QueryOptions<Far>): QueryOptions<Far> {
    const { where = {}, ...rest } = options;
    this.reads.push(where);
    return { ...rest, where: { ...where, tenant_id: this.#tenantId } };
  }
}

const parentDefinition = defineRepository({
  name: "Parents",
  table: parentTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const bridgeDefinition = defineRepository({
  name: "Bridges",
  table: bridgeTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const farDefinition = defineRepository({
  name: "Far",
  table: farTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const pivotDefinition = defineRepository({
  name: "Pivots",
  table: pivotTable,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const scopedDefinition = defineRepository({
  name: "ScopedFar",
  table: farTable,
  dependencies: [],
  create: (binding) => new ScopedFarRepository(binding, 7),
  hooks: { transformQuery: scopedPlan },
});
function scopedPlan(
  plan: QueryOptions<Far>,
  binding: RepositoryBinding<Far, "id">,
): QueryOptions<Far> {
  return binding.session.repository(scopedDefinition).applyScope(plan);
}
const url = process.env.DATABASE_URL;
assert.ok(url);
const driver = process.env.DB_CONNECTION;
assert.ok(driver === "sqlite" || driver === "mysql" || driver === "pgsql");
const connection: DatabaseConnectionOptions =
  driver === "sqlite" ? { driver, filename: url.replace(/^sqlite:/, "") } : { driver, url, max: 2 };
const app = createApplication({
  providers: [],
  services: createDatabaseBindings({
    default: "main",
    connections: { main: connection },
    repositories: [
      parentDefinition,
      bridgeDefinition,
      farDefinition,
      pivotDefinition,
      scopedDefinition,
    ],
  }),
});
await app.start();
try {
  await app.run(async (scope) => {
    const database = scope.resolve(DATABASE_SESSION_TOKEN);
    const parents = database.repository(parentDefinition),
      bridges = database.repository(bridgeDefinition),
      far = database.repository(farDefinition),
      pivots = database.repository(pivotDefinition);
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
    const scoped = database.repository(scopedDefinition);
    const loaded = await far.loadBelongsToManyForParents([first, first, second], pivot, scoped);
    assert.deepEqual(
      loaded.get(first.id)?.map((row) => Number(row.id)),
      [Number(visible.id)],
    );
    assert.deepEqual(loaded.get(second.id), []);
    assert.equal(scoped.reads.length, 1);
    assert.equal(database.repository(scopedDefinition), scoped);
    const empty = await far.loadBelongsToManyForParents([second], pivot, scoped);
    assert.deepEqual(empty.get(second.id), []);
    assert.equal(scoped.reads.length, 1);
    assert.deepEqual(await far.loadBelongsToManyForParents([], pivot, scoped), new Map());
    assert.equal(scoped.reads.length, 1);
    console.log(
      "PASS installed through/pivot relations, scoped predicates, soft deletes and typed query hooks and exact bound subclass dispatch",
    );
  });
} finally {
  await app.stop();
}
