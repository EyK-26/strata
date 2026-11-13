import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

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
class ProductEntity extends Model<Row, "id"> {
  label() {
    return this.get("title");
  }
}
class FeaturedEntity extends ProductEntity {
  featured() {
    return true;
  }
}
const repository = defineRepository({
  name: "products",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
const ProductDefinition = defineModel({
  name: "Product",
  repository,
  dependencies: [],
  attributes: { timestamps: false, guarded: [], casts: { active: "boolean", meta: "json" } },
  scopes: [(query) => query.where({ tenant_id: 1 })],
  construct: (state, binding) => new ProductEntity(state, binding),
});
const FeaturedDefinition = defineModel({
  name: "Featured",
  repository,
  dependencies: [],
  attributes: { timestamps: false, guarded: [], casts: { active: "boolean", meta: "json" } },
  scopes: [(query) => query.where({ tenant_id: 1 })],
  construct: (state, binding) => new FeaturedEntity(state, binding),
});
async function fixture(
  work: (
    Product: BoundModel<Row, "id", ProductEntity>,
    Featured: BoundModel<Row, "id", FeaturedEntity>,
    selects: string[],
  ) => Promise<void>,
) {
  const connection = createSqliteConnection(":memory:");
  const selects: string[] = [];
  try {
    await connection.unsafe(
      "CREATE TABLE projection_products(id INTEGER PRIMARY KEY,tenant_id INTEGER DEFAULT 1,title TEXT NOT NULL,price INTEGER DEFAULT 10,active INTEGER DEFAULT 1,meta TEXT DEFAULT '{\"tags\":[]}',note TEXT)",
    );
    await connection.unsafe(
      "INSERT INTO projection_products VALUES(1,1,'one',10,1,'{\"tags\":[\"first\"]}',null),(2,1,'two',20,0,'{\"tags\":[]}',null),(3,2,'other',30,1,'{\"tags\":[]}',null)",
    );
    await withBoundDatabase(
      {
        definition: {
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          repositories: [repository],
          models: [ProductDefinition, FeaturedDefinition],
        },
        driver: "sqlite",
        connection: {
          unsafe: async <T>(sql: string, params: readonly unknown[] = []) => {
            if (sql.startsWith("SELECT")) selects.push(sql);
            return connection.unsafe<T>(sql, params);
          },
        },
      },
      async (db) => work(db.model(ProductDefinition), db.model(FeaturedDefinition), selects),
    );
  } finally {
    connection.close();
  }
}
test("projection keeps tenant scopes and boolean/JSON casts but exposes no omitted fields or model methods", async () => {
  await fixture(async (Product, Featured, selects) => {
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
});

test("projections return null/empty for missing rows and reject empty or unknown columns at runtime", async () => {
  await fixture(async (Product) => {
    expect(await Product.where({ id: 99 }).select("title").first()).toBeNull();
    expect(await Product.where({ id: 99 }).select("title").get()).toEqual([]);
  });
  await expect(
    fixture(async (Product) => {
      await Product.query().select().get();
    }),
  ).rejects.toThrow("at least one column");
  await expect(
    fixture(async (Product) => {
      await Product.query()
        .select("missing" as never)
        .get();
    }),
  ).rejects.toThrow("Unknown projection column");
});

test("typed nested filters and explicit dynamic qualified filters preserve scope containment", async () => {
  await fixture(async (Product, _Featured, _selects) => {
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
});

test("omitted generated/default/nullable columns and trusted partial hydration keep existing write behavior", async () => {
  await fixture(async (Product, _Featured, _selects) => {
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
});
