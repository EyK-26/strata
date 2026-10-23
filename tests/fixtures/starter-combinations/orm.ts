/** Migrated native consumer. All business writes/reads use framework repositories and models. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import FailedJobRepository from "@getstrata/core/queue/failedJobRepository";
import FailedJobService from "@getstrata/core/queue/failedJobService";

const { bootstrapApp } = await import(resolve("src/bootstrap/createApp.ts"));
const { closeDatabase } = await import(resolve("src/bootstrap/database.ts"));
type OrderRow = { id: number; reference: string; status: string };
type LineRow = {
  id: number;
  order_id: number;
  kind: string;
  score: number;
  deleted_at: string | null;
};
type Pivot = { id: number; owner_id: number; child_id: number };
const orderTable = defineTable<OrderRow, "id">({
  name: "combination_orders",
  primaryKey: "id",
  columns: ["id", "reference", "status"],
});
const lineTable = defineTable<LineRow, "id">({
  name: "combination_lines",
  primaryKey: "id",
  columns: ["id", "order_id", "kind", "score", "deleted_at"],
  softDeletes: true,
});
const orders = new BaseRepository(orderTable),
  lines = new BaseRepository(lineTable);
const pivot = new BaseRepository(
  defineTable<Pivot, "id">({
    name: "combination_pivot",
    primaryKey: "id",
    columns: ["id", "owner_id", "child_id"],
  }),
);
class Line extends Model<LineRow, "id"> {
  static override $guarded = [];
  static override $timestamps = false;
}
class Order extends Model<OrderRow, "id"> {
  static override $guarded = [];
  static override $timestamps = false;
  lines() {
    return this.hasMany<LineRow, "id">(Line, "order_id");
  }
  recentLines() {
    return this.lines().where({ kind: "keep" }).orderBy({ score: "DESC", id: "ASC" }).limit(1);
  }
}
registerModelRepository(Order, orders);
registerModelRepository(Line, lines);
const app = await bootstrapApp({ migrate: false });
try {
  for (const id of [1, 2, 3]) await Order.create({ id, reference: `order-${id}`, status: "draft" });
  for (let id = 1; id <= 7; id++) {
    const order_id = id <= 3 || id === 7 ? 1 : 2;
    await Line.create({
      id,
      order_id,
      kind: id % 3 === 0 ? "drop" : "keep",
      score: id % 3 === 0 ? 99 : id % 3,
      deleted_at: id === 7 ? "2026-01-01 00:00:00" : null,
    });
    await pivot.create({ id, owner_id: order_id, child_id: id });
  }
  const lazy = await Order.query().orderBy({ id: "ASC" }).get();
  const expected = await Promise.all(
    lazy.map(async (order) => (await order.recentLines().get()).map((line) => line.id)),
  );
  assert.deepEqual(expected, [[2], [5], []]);
  const all = await Order.with("recentLines").orderBy({ id: "ASC" }).get();
  const page = await Order.with("recentLines")
    .orderBy({ id: "ASC" })
    .paginate({ page: 1, perPage: 3 });
  const keyset = await Order.with("recentLines").keysetPaginate({
    perPage: 3,
    orderBy: [{ column: "id", direction: "asc" }],
  });
  assert.equal(JSON.stringify(all), JSON.stringify(page.data));
  assert.equal(JSON.stringify(all), JSON.stringify(keyset.data));
  assert.deepEqual(
    all.map((order) => (order.loaded("recentLines") as Line[]).map((line) => line.id)),
    expected,
  );
  assert.equal(page.meta.total, 3);
  assert.deepEqual((await Order.with("recentLines").paginate({ page: 2, perPage: 3 })).data, []);
  for (const relation of ["many", "morph", "through", "pivot"] as const) {
    const options = {
      limit: 1,
      offset: 1,
      orderBy: { score: "DESC" as const },
      whereNodes: [{ kind: "and" as const, where: { kind: "keep" } }],
    };
    const parents = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result =
      relation === "many"
        ? await lines.loadHasManyForParents(
            parents,
            { type: "hasMany", name: "items", localKey: "id", foreignKey: "order_id" },
            options,
          )
        : relation === "morph"
          ? await lines.loadMorphManyForParents(
              parents,
              {
                type: "morphMany",
                name: "items",
                localKey: "id",
                morphTypeKey: "kind",
                morphIdKey: "order_id",
                morphType: "keep",
              },
              options,
            )
          : relation === "through"
            ? await lines.loadHasManyThroughForParents(
                parents,
                {
                  type: "hasManyThrough",
                  name: "items",
                  localKey: "id",
                  throughTable: "combination_pivot",
                  firstKey: "owner_id",
                  secondLocalKey: "child_id",
                  secondKey: "id",
                },
                options,
              )
            : await lines.loadBelongsToManyForParents<
                { id: number },
                LineRow,
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
                  pivotTable: "combination_pivot",
                  parentKey: "id",
                  relatedKey: "id",
                  foreignPivotKey: "owner_id",
                  relatedPivotKey: "child_id",
                },
                lines,
                options,
              );
    assert.deepEqual(
      parents.map((parent) => result.get(parent.id)?.map((line) => line.id)),
      [[1], [4], []],
    );
    for (const rows of result.values())
      for (const row of rows)
        assert.ok(
          !Object.keys(row).some(
            (key) => key.startsWith("__strata_") || key === "__through_parent_id",
          ),
        );
  }
  let casts = 0;
  class ObservedOrder extends Order {
    protected static override async dehydrateAttributes(attributes: Record<string, unknown>) {
      casts++;
      return { ...attributes, reference: `stored:${attributes.reference}` };
    }
  }
  registerModelRepository(ObservedOrder, orders);
  ObservedOrder.observe({
    async saving(model) {
      await Promise.resolve();
      model.mergeAttributes({ status: "saved" });
    },
    async creating(model) {
      await Promise.resolve();
      model.mergeAttributes({ status: "created" });
    },
  });
  const observed = await ObservedOrder.create({ id: 101, reference: "observer", status: "draft" });
  assert.equal(observed.get("status"), "created");
  assert.equal(casts, 1);
  assert.equal((await orders.findByIdOrThrow(observed.id)).reference, "stored:observer");
  const forced = await ObservedOrder.create(
    { id: 102, reference: "forced" },
    { status: "trusted" },
  );
  assert.equal(forced.get("status"), "trusted");
  assert.equal(casts, 2);
  const failures = new FailedJobService(new FailedJobRepository());
  const payload = { accented: "Préparation", nested: { count: 2 } };
  const failure = await failures.recordFailure({
    jobName: "owned-replay",
    jobId: "same-id",
    payload,
    exception: "HTTP 503",
  });
  assert.deepEqual(failure.payload, payload);
  assert.ok(failure.failed_at instanceof Date);
  assert.ok(
    Math.abs(failure.failed_at.getTime() - Date.now()) < 5000,
    "Failure timestamps must retain the current UTC instant",
  );
  await failures.retry(failure.id, async (record) => {
    assert.deepEqual(record.payload, payload);
    assert.equal(record.job_id, "same-id");
    assert.equal((await failures.listRecent()).length, 1);
  });
  assert.deepEqual(await failures.listRecent(), []);
  console.log(
    JSON.stringify({
      consumer: "orm-combination-boundaries",
      offsetPages: "attached",
      boundedRelations: 4,
      observerCasts: casts,
      durableReplay: true,
    }),
  );
} finally {
  await app.context.dispose();
  await closeDatabase();
}
