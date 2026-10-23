import { expect, test } from "bun:test";
import { verifyPassword } from "@getstrata/core/auth/password";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type OrderRow = { id: number; reference: string; status: string };
type LineRow = { id: number; order_id: number; name: string };

async function makeFixture() {
  const db = createSqliteConnection(":memory:");
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
  registerModelRepository(Order, new BaseRepository(orders, db));
  registerModelRepository(Line, new BaseRepository(lines, db));
  // Fixture schema only; application records below use the ORM.
  await db.unsafe(
    "CREATE TABLE orders(id INTEGER PRIMARY KEY,reference TEXT,status TEXT DEFAULT 'draft')",
  );
  await db.unsafe("CREATE TABLE lines(id INTEGER PRIMARY KEY,order_id INTEGER,name TEXT)");
  return { Order, Line, db };
}

async function fixture(check: (models: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const models = await makeFixture();
  try {
    await runWithSqlDialect("sqlite", () => check(models));
  } finally {
    await models.db.close();
  }
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
      (parent.loaded("recentLines") as InstanceType<typeof Line>[]).map((line) => line.id),
    );
    expect(lazy).toEqual([[3, 2], [6, 5], []]);
    expect(eager).toEqual(lazy);
  });
});

for (const event of ["saving", "creating"] as const) {
  test(`static create persists async ${event} edits like instance save`, async () => {
    await fixture(async ({ Order }) => {
      Order.observe({
        [event]: async (model: Model<OrderRow, "id">) => {
          await Promise.resolve();
          model.mergeAttributes({ status: "awaiting-payment" });
        },
      });
      const created = await Order.create({ reference: "static", status: "original" });
      const saved = Order.newFromRecord({ reference: "instance", status: "original" }, false);
      await saved.save();
      expect(created.get("status")).toBe("awaiting-payment");
      expect((await Order.findOrFail(created.id)).get("status")).toBe(saved.get("status"));
    });
  });
}

test("trusted forced attributes retain priority over observer edits", async () => {
  await fixture(async ({ Order }) => {
    Order.observe({
      creating(model) {
        model.mergeAttributes({ status: "observer" });
      },
    });
    const created = await Order.create(
      { reference: "forced", status: "request" },
      { status: "trusted" },
    );
    expect(created.get("status")).toBe("trusted");
    expect((await Order.findOrFail(created.id)).get("status")).toBe("trusted");
  });
});

test("static create observers retain resolved initial hashes and their replacement is hashed before SQL", async () => {
  await fixture(async ({ Order }) => {
    class HashedOrder extends Order {
      static override $casts = { status: "hashed" as const };
    }
    registerModelRepository(HashedOrder, Order.repository<OrderRow, "id">());
    const seen: unknown[] = [];
    HashedOrder.observe({
      async creating(model) {
        seen.push(model.get("status"));
        await Promise.resolve();
        model.mergeAttributes({ status: "observer-secret" });
      },
    });
    const created = await HashedOrder.create({ reference: "hashed", status: "input-secret" });
    expect(seen).toHaveLength(1);
    expect(await verifyPassword("input-secret", String(seen[0]))).toBe(true);
    const stored = (await Order.repository<OrderRow, "id">().findByIdOrThrow(created.id)).status;
    expect(await verifyPassword("observer-secret", stored)).toBe(true);
    expect(await verifyPassword("input-secret", stored)).toBe(false);
  });
});

for (const event of ["saving", "creating"] as const)
  test(`cancelled ${event} prevents changed-field casts and inserts`, async () => {
    await fixture(async ({ Order }) => {
      let casts = 0;
      class Cancelled extends Order {
        protected static override dehydrateAttributes(values: Record<string, unknown>) {
          casts++;
          return values;
        }
      }
      registerModelRepository(Cancelled, Order.repository<OrderRow, "id">());
      Cancelled.observe({ [event]: () => false });
      await expect(Cancelled.create({ reference: "cancelled", status: "draft" })).rejects.toThrow(
        "cancelled by an observer",
      );
      expect(casts).toBe(1);
      expect(await Order.repository<OrderRow, "id">().count()).toBe(0);
    });
  });
