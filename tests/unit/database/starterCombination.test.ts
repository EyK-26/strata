import { expect, test } from "bun:test";
import { verifyPassword } from "@getstrata/core/auth/password";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
  type ModelDefinition,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type OrderRow = { id: number; reference: string; status: string };
type LineRow = { id: number; order_id: number; name: string };

class LineEntity extends Model<LineRow, "id"> {}
class OrderEntity extends Model<OrderRow, "id"> {
  lines() {
    return this.hasMany(LineDefinition, "order_id");
  }
  recentLines() {
    return this.lines().orderBy({ id: "DESC" }).limit(2);
  }
}
const orders = defineTable<OrderRow, "id">({
  name: "orders",
  primaryKey: "id",
  columns: ["id", "reference", "status"],
});
const lines = defineTable<LineRow, "id">({
  name: "lines",
  primaryKey: "id",
  columns: ["id", "order_id", "name"],
});
const lineRepository = defineRepository({
  name: "lines",
  table: lines,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const LineDefinition: ModelDefinition<LineRow, "id", LineEntity> = defineModel({
  name: "Line",
  repository: lineRepository,
  dependencies: [],
  attributes: { guarded: [], timestamps: false },
  construct: (state, binding) => new LineEntity(state, binding),
});
type Fixture = {
  Order: BoundModel<OrderRow, "id", OrderEntity>;
  Line: BoundModel<LineRow, "id", LineEntity>;
  HashedOrder: BoundModel<OrderRow, "id", OrderEntity>;
  Cancelled: BoundModel<OrderRow, "id", OrderEntity>;
};
async function fixture(
  check: (models: Fixture) => Promise<void>,
  options: {
    observer?: ModelObserver<OrderEntity>;
    hashedObserver?: ModelObserver<OrderEntity>;
    cancelEvent?: "saving" | "creating";
    countCast?: () => void;
  } = {},
) {
  const Observer = createServiceToken<ModelObserver<OrderEntity>>("order-observer");
  const HashObserver = createServiceToken<ModelObserver<OrderEntity>>("hashed-order-observer");
  const CancelObserver = createServiceToken<ModelObserver<OrderEntity>>("cancelled-order-observer");
  const orderRepository = defineRepository({
    name: "orders",
    table: orders,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const cancelledRepository = defineRepository({
    name: "cancelled-orders",
    table: orders,
    dependencies: [],
    create: (binding) => new BaseRepository(binding),
  });
  const OrderDefinition = defineModel({
    name: "Order",
    repository: orderRepository,
    dependencies: [],
    attributes: { guarded: [], timestamps: false },
    observers: [Observer],
    construct: (state, binding) => new OrderEntity(state, binding),
  });
  const HashDefinition = defineModel({
    name: "HashedOrder",
    repository: orderRepository,
    dependencies: [],
    attributes: { guarded: [], timestamps: false, casts: { status: "hashed" } },
    observers: [HashObserver],
    construct: (state, binding) => new OrderEntity(state, binding),
  });
  const CancelDefinition = defineModel({
    name: "Cancelled",
    repository: cancelledRepository,
    dependencies: [],
    attributes: {
      guarded: [],
      timestamps: false,
      dehydrate: (values) => {
        options.countCast?.();
        return { ...values };
      },
    },
    observers: [CancelObserver],
    construct: (state, binding) => new OrderEntity(state, binding),
  });
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [orderRepository, lineRepository, cancelledRepository],
        models: [OrderDefinition, LineDefinition, HashDefinition, CancelDefinition],
      },
      services: [
        valueService(Observer, options.observer ?? {}),
        valueService(HashObserver, options.hashedObserver ?? {}),
        valueService(
          CancelObserver,
          options.cancelEvent ? { [options.cancelEvent]: () => false } : {},
        ),
      ],
    },
    async (db) => {
      await db.execute({
        text: "CREATE TABLE orders(id INTEGER PRIMARY KEY,reference TEXT,status TEXT DEFAULT 'draft')",
        params: [],
      });
      await db.execute({
        text: "CREATE TABLE lines(id INTEGER PRIMARY KEY,order_id INTEGER,name TEXT)",
        params: [],
      });
      await check({
        Order: db.model(OrderDefinition),
        Line: db.model(LineDefinition),
        HashedOrder: db.model(HashDefinition),
        Cancelled: db.model(CancelDefinition),
      });
    },
  );
}

test("offset pages attach the same model relations as get and keyset, including empty pages", async () => {
  await fixture(async ({ Order, Line }) => {
    const order = await Order.create({ reference: "one" });
    await Line.create({ order_id: order.id, name: "line" });
    const get = await Order.with("lines").get();
    const page = await Order.with("lines").paginate({ page: 1, perPage: 10 });
    const keyset = await Order.with("lines").keysetPaginate({
      perPage: 10,
      orderBy: [{ column: "id", direction: "asc" }],
    });
    expect(page.data[0]?.loaded("lines")).toHaveLength(1);
    expect(JSON.stringify(page.data)).toBe(JSON.stringify(get));
    expect(JSON.stringify(page.data)).toBe(JSON.stringify(keyset.data));
    expect(page.meta.total).toBe(1);
    expect((await Order.with("lines").paginate({ page: 2, perPage: 10 })).data).toEqual([]);
  });
});

test("eager limits retain each parent's ordered children", async () => {
  await fixture(async ({ Order, Line }) => {
    for (const reference of ["one", "two", "empty"]) {
      const order = await Order.create({ reference });
      if (reference !== "empty")
        for (let i = 0; i < 3; i++) await Line.create({ order_id: order.id, name: String(i) });
    }
    const parents = await Order.query().orderBy({ id: "ASC" }).get();
    const lazy = await Promise.all(
      parents.map(async (parent) =>
        (await parent.recentLines().get()).map((line) => {
          if (typeof line.id !== "number") throw new Error("Expected SQLite numeric identity");
          return line.id;
        }),
      ),
    );
    const eager = (await Order.with("recentLines").orderBy({ id: "ASC" }).get()).map((parent) =>
      (parent.loaded("recentLines") as LineEntity[]).map((line) => line.id),
    );
    expect(lazy).toEqual([[3, 2], [6, 5], []]);
    expect(eager).toEqual(lazy);
  });
});

for (const event of ["saving", "creating"] as const) {
  test(`bound create persists async ${event} edits like instance save`, async () => {
    await fixture(
      async ({ Order }) => {
        const created = await Order.create({ reference: "static", status: "original" });
        const saved = Order.newFromRecord({ reference: "instance", status: "original" }, false);
        await saved.save();
        expect(created.get("status")).toBe("awaiting-payment");
        expect((await Order.findOrFail(created.id)).get("status")).toBe(saved.get("status"));
      },
      {
        observer: {
          [event]: async (model: Model<OrderRow, "id">) => {
            await Promise.resolve();
            model.mergeAttributes({ status: "awaiting-payment" });
          },
        },
      },
    );
  });
}

test("trusted forced attributes retain priority over observer edits", async () => {
  await fixture(
    async ({ Order }) => {
      const created = await Order.create(
        { reference: "forced", status: "request" },
        { status: "trusted" },
      );
      expect(created.get("status")).toBe("trusted");
      expect((await Order.findOrFail(created.id)).get("status")).toBe("trusted");
    },
    {
      observer: {
        creating: (model) => {
          model.mergeAttributes({ status: "observer" });
        },
      },
    },
  );
});

test("bound create observers retain resolved initial hashes and their replacement is hashed before SQL", async () => {
  const seen: unknown[] = [];
  await fixture(
    async ({ Order, HashedOrder }) => {
      const created = await HashedOrder.create({ reference: "hashed", status: "input-secret" });
      expect(seen).toHaveLength(1);
      expect(await verifyPassword("input-secret", String(seen[0]))).toBe(true);
      const stored = (await Order.repository().findByIdOrThrow(created.id)).status;
      expect(await verifyPassword("observer-secret", stored)).toBe(true);
      expect(await verifyPassword("input-secret", stored)).toBe(false);
    },
    {
      hashedObserver: {
        creating: async (model) => {
          seen.push(model.get("status"));
          await Promise.resolve();
          model.mergeAttributes({ status: "observer-secret" });
        },
      },
    },
  );
});

for (const event of ["saving", "creating"] as const)
  test(`cancelled ${event} prevents changed-field casts and inserts`, async () => {
    let casts = 0;
    await fixture(
      async ({ Order, Cancelled }) => {
        await expect(Cancelled.create({ reference: "cancelled", status: "draft" })).rejects.toThrow(
          "cancelled by an observer",
        );
        expect(casts).toBe(1);
        expect(await Order.repository().count()).toBe(0);
      },
      {
        cancelEvent: event,
        countCast: () => {
          casts++;
        },
      },
    );
  });
