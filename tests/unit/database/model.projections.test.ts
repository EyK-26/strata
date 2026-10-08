import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = {
  id: number;
  tenant_id: number;
  title: string;
  price: number;
  active: boolean;
  meta: { tags: string[] };
  note: string | null;
};
const table = defineTable<Row, "id">({
  name: "projection_products",
  primaryKey: "id",
  columns: ["id", "tenant_id", "title", "price", "active", "meta", "note"],
});
class Product extends defineModel(table) {
  static override $timestamps = false;
  static override $guarded = [];
  static override $casts = { active: "boolean", meta: "json" } as const;
  static override boot() {
    Product.addGlobalScope("tenant", (query) => query.where({ tenant_id: 1 }));
  }
  label() {
    return this.get("title");
  }
}
class Featured extends Product {
  static override boot() {
    Featured.addGlobalScope("tenant", (query) => query.where({ tenant_id: 1 }));
  }
  featured() {
    return true;
  }
}
let connection: ReturnType<typeof createSqliteConnection>;
let selects: string[];
beforeEach(async () => {
  connection = createSqliteConnection(":memory:");
  useSqlDialect("sqlite");
  await connection.unsafe(
    "CREATE TABLE projection_products(id INTEGER PRIMARY KEY,tenant_id INTEGER DEFAULT 1,title TEXT NOT NULL,price INTEGER DEFAULT 10,active INTEGER DEFAULT 1,meta TEXT DEFAULT '{\"tags\":[]}',note TEXT)",
  );
  await connection.unsafe(
    "INSERT INTO projection_products VALUES(1,1,'one',10,1,'{\"tags\":[\"first\"]}',null),(2,1,'two',20,0,'{\"tags\":[]}',null),(3,2,'other',30,1,'{\"tags\":[]}',null)",
  );
  selects = [];
  bindDatabaseConnection({
    unsafe: async <T>(sql: string, params: readonly unknown[] = []) => {
      if (sql.startsWith("SELECT")) selects.push(sql);
      return await connection.unsafe<T>(sql, params);
    },
  });
});
afterEach(() => {
  resetBoundDatabaseConnection();
  resetSqlDialect();
  connection.close();
});

test("projection keeps tenant scopes and boolean/JSON casts but exposes no omitted fields or model methods", async () => {
  const projection = Product.query().orderBy({ id: "asc" }).select("title", "active", "meta");
  const first = await projection.first();
  expect(first).toEqual({ title: "one", active: true, meta: { tags: ["first"] } });
  expect(first).not.toHaveProperty("id");
  expect(first).not.toHaveProperty("save");
  const rows = await projection.get();
  expect(rows).toHaveLength(2);
  expect(rows[1]).toEqual({ title: "two", active: false, meta: { tags: [] } });
  expect(selects).toHaveLength(2);
  expect(selects[0]).not.toContain('"price"');
  expect(selects[0]).toContain('"tenant_id"');
  // Normal reads retain concrete subclass methods, unrelated to the projection.
  const featured = await Featured.findOrFail(1);
  expect(featured.featured()).toBe(true);
  expect(featured.label()).toBe("one");
});

test("projections return null/empty for missing rows and reject empty or unknown columns at runtime", async () => {
  expect(await Product.where({ id: 99 }).select("title").first()).toBeNull();
  expect(await Product.where({ id: 99 }).select("title").get()).toEqual([]);
  await expect(Product.query().select().get()).rejects.toThrow("at least one column");
  await expect(
    Product.query()
      .select("missing" as never)
      .get(),
  ).rejects.toThrow("Unknown projection column");
});

test("typed nested filters and explicit dynamic qualified filters preserve scope containment", async () => {
  const rows = await Product.query()
    .where((builder) =>
      builder
        .where({ price: { gte: 10 } })
        .orWhereGroup((nested) => nested.where({ title: "other" })),
    )
    .select("title")
    .get();
  expect(rows).toEqual([{ title: "one" }, { title: "two" }]);
  expect(
    await Product.query()
      .whereDynamic({ "projection_products.title": "one" })
      .select("price")
      .first(),
  ).toEqual({ price: 10 });
});

test("omitted generated/default/nullable columns and trusted partial hydration keep existing write behavior", async () => {
  const created = await Product.create({ title: "defaults", note: null });
  expect(created.id).toBeNumber();
  expect(created.get("price")).toBe(10);
  expect(created.get("active")).toBe(true);
  const trusted = Product.newFromTrustedRecord({ id: created.id, title: "partial" });
  expect(Object.keys(trusted.toObject())).toEqual(["id", "title"]);
  expect(trusted.get("title")).toBe("partial");
  // Dirty-write regression: a trusted partial record updates only explicitly changed attributes.
  await trusted.update({ title: "updated" });
  expect((await Product.findOrFail(created.id)).get("price")).toBe(10);
});
