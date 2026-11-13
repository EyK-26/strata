import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  defineModel,
  defineRepository,
  type ModelDefinition,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = { sku: string; title: string };
const table = defineTable<Row, "sku">({
  name: "definition_products",
  primaryKey: "sku",
  columns: ["sku", "title"],
});
const repository = defineRepository({
  name: "products",
  table,
  dependencies: [],
  create: (binding) => new BaseRepository(binding),
});
class Product extends Model<Row, "sku"> {
  label() {
    return this.get("title");
  }
}
const ProductDefinition = defineModel({
  name: "Product",
  repository,
  dependencies: [],
  attributes: { fillable: ["sku", "title"], timestamps: false },
  construct: (state, binding) => new Product(state, binding),
});
const config = {
  default: "main",
  connections: { main: { driver: "sqlite" as const, filename: ":memory:" } },
  repositories: [repository],
  models: [ProductDefinition],
};
async function schema(db: Parameters<Parameters<typeof withBoundDatabase>[1]>[0]) {
  await db.execute({
    text: "CREATE TABLE definition_products (sku TEXT PRIMARY KEY, title TEXT NOT NULL)",
    params: [],
  });
}

describe("declarative model repositories", () => {
  test("immutable definitions do not construct entities before a live facade is selected", async () => {
    let constructors = 0;
    class Featured extends Product {
      #feature = "featured";
      feature() {
        return this.#feature;
      }
    }
    const FeaturedDefinition = defineModel({
      name: "Featured",
      repository,
      dependencies: [],
      attributes: {},
      construct: (state, binding) => {
        constructors++;
        return new Featured(state, binding);
      },
    });
    expect(constructors).toBe(0);
    expect(Object.isFrozen(FeaturedDefinition)).toBe(true);
    await withBoundDatabase(
      { definition: { ...config, models: [ProductDefinition, FeaturedDefinition] } },
      async (db) => {
        const model = db.model(ProductDefinition);
        expect(model.repository().getTable()).toEqual(table);
        expect(db.model(ProductDefinition)).toBe(model);
        expect(db.model(FeaturedDefinition)).not.toBe(model);
        expect(constructors).toBe(0);
        expect(db.model(FeaturedDefinition).newRecord({ title: "feature" }).feature()).toBe(
          "featured",
        );
        expect(constructors).toBe(1);
      },
    );
  });
  test("preserves concrete models, non-id primary keys and explicit transaction rollback", async () => {
    const app = createApplication({ providers: [], services: createDatabaseBindings(config) });
    await app.start();
    try {
      await app.run(async (scope) => {
        const db = scope.resolve(DATABASE_SESSION_TOKEN);
        await schema(db);
        const saved = await db.model(ProductDefinition).create({ sku: "first", title: "book" });
        expect(saved).toBeInstanceOf(Product);
        expect(saved.id).toBe("first");
        expect(saved.label()).toBe("book");
      });
      await expect(
        app.run((scope) =>
          scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (tx) => {
            await tx.model(ProductDefinition).create({ sku: "rollback", title: "rollback" });
            throw new Error("abort");
          }),
        ),
      ).rejects.toThrow("abort");
      await app.run(async (scope) => {
        const model = scope.resolve(DATABASE_SESSION_TOKEN).model(ProductDefinition);
        expect(await model.find("rollback")).toBeNull();
        expect((await model.findOrFail("first")).label()).toBe("book");
      });
    } finally {
      await app.stop();
    }
  });
  test("the same definitions follow concurrent explicit application connections", async () => {
    const apps = [
      createApplication({ providers: [], services: createDatabaseBindings(config) }),
      createApplication({ providers: [], services: createDatabaseBindings(config) }),
    ];
    await Promise.all(apps.map((app) => app.start()));
    try {
      const results = await Promise.all(
        apps.map((app, index) =>
          app.run(async (scope) => {
            const db = scope.resolve(DATABASE_SESSION_TOKEN);
            await schema(db);
            await db
              .model(ProductDefinition)
              .create({ sku: "shared", title: index === 0 ? "first tenant" : "second tenant" });
            if (index === 0) await Bun.sleep(5);
            return (await db.model(ProductDefinition).findOrFail("shared")).get("title");
          }),
        ),
      );
      expect(results).toEqual(["first tenant", "second tenant"]);
    } finally {
      await Promise.all(apps.map((app) => app.stop()));
    }
  });
  test("custom repository constructors are selected by exact immutable definitions", async () => {
    class CustomRepository extends BaseRepository<Row, "sku"> {
      #label = "custom";
      label() {
        return this.#label;
      }
    }
    const custom = defineRepository({
      name: "custom",
      table,
      dependencies: [],
      create: (binding) => new CustomRepository(binding),
    });
    const customModel = defineModel({
      name: "CustomProduct",
      repository: custom,
      dependencies: [],
      attributes: {},
      construct: (state, binding) => new Product(state, binding),
    });
    await withBoundDatabase(
      {
        definition: {
          ...config,
          repositories: [repository, custom],
          models: [ProductDefinition, customModel],
        },
      },
      async (db) => {
        expect(db.repository(custom).label()).toBe("custom");
        expect(db.model(customModel).repository()).toBe(db.repository(custom));
        expect(db.model(ProductDefinition).repository()).not.toBe(db.repository(custom));
      },
    );
  });
  test("all names and morph aliases are prepared before relation construction", async () => {
    const child = defineModel({
      name: "DefinitionChild",
      aliases: ["definition-child"],
      repository,
      dependencies: [],
      attributes: {},
      construct: (state, binding) => new Product(state, binding),
    });
    class Parent extends Product {
      children() {
        return this.hasMany("definition-child", "sku", "sku");
      }
    }
    const parent = defineModel({
      name: "DefinitionParent",
      repository,
      dependencies: [],
      attributes: {},
      construct: (state, binding) => new Parent(state, binding),
    });
    await withBoundDatabase({ definition: { ...config, models: [parent, child] } }, async (db) => {
      expect(db.model(parent).newRecord({ sku: "parent", title: "parent" }).children().kind).toBe(
        "hasMany",
      );
      expect(db.model(parent)).toBe(db.model(parent));
    });
  });
  test("duplicate aliases fail before entity constructors and pool startup", () => {
    let constructors = 0;
    const make = (name: string) =>
      defineModel({
        name,
        aliases: ["duplicate"],
        repository,
        dependencies: [],
        attributes: {},
        construct: (state, binding) => {
          constructors++;
          return new Product(state, binding);
        },
      });
    expect(() => createDatabaseBindings({ ...config, models: [make("one"), make("two")] })).toThrow(
      "Duplicate model alias",
    );
    expect(constructors).toBe(0);
  });
  test("unregistered definitions reject before constructing a model", async () => {
    const missing: ModelDefinition<Row, "sku", Product> = defineModel({
      name: "Missing",
      repository,
      dependencies: [],
      attributes: {},
      construct: (state, binding) => new Product(state, binding),
    });
    await withBoundDatabase({ definition: config }, async (db) => {
      expect(() => db.model(missing)).toThrow();
      expect(db.model(ProductDefinition).repository().getTable()).toEqual(table);
    });
  });
});
