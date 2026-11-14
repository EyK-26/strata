import { expect, test } from "bun:test";
import { createModel, Model } from "../../../src/core/database/model";
import { defineTable } from "../../../src/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = { sku: string; title: string; secret: string };
const table = defineTable<Row, "sku">({
  name: "simple_products",
  primaryKey: "sku",
  columns: ["sku", "title", "secret"],
});
const Product = createModel({
  name: "SimpleProduct",
  table,
  attributes: { fillable: ["sku", "title"], hidden: ["secret"] },
});

test("ordinary declarations use canonical entities with explicit session and transaction ownership", async () => {
  expect(Product.attributes.timestamps).toBe(false);
  expect(Object.isFrozen(Product)).toBe(true);
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [Product.repository],
        models: [Product],
      },
    },
    async (db) => {
      await db.execute({
        text: "CREATE TABLE simple_products (sku TEXT PRIMARY KEY, title TEXT, secret TEXT DEFAULT 'server')",
        params: [],
      });
      const model = db.model(Product);
      const saved = await model.create({ sku: "one", title: "First", secret: "injected" });
      expect(saved).toBeInstanceOf(Model);
      const key: string = saved.id;
      expect(key).toBe("one");
      expect(saved.get("secret")).toBe("server");
      expect(saved.toJSON()).not.toHaveProperty("secret");
      await expect(
        db.transaction(async (tx) => {
          await tx.model(Product).create({ sku: "rolled-back", title: "discarded" });
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await model.find("rolled-back")).toBeNull();
      await saved.update({ title: "Updated" });
      expect((await model.findOrFail("one")).get("title")).toBe("Updated");
      const checkTypes = () => {
        // @ts-expect-error The primary key remains a string.
        model.find(123);
        // @ts-expect-error Attributes remain checked against the row.
        model.create({ missing: true });
      };
      expect(typeof checkTypes).toBe("function");
    },
  );
});

test("declaration metadata remains snapshotted and rejects accessors without evaluating them", () => {
  const fillable: (keyof Row)[] = ["title"];
  const declaration = createModel({ name: "Snapshot", table, attributes: { fillable } });
  fillable.push("secret");
  expect(declaration.attributes.fillable).toEqual(["title"]);
  let evaluated = false;
  expect(() =>
    createModel({
      name: "Invalid",
      table,
      attributes: {
        get fillable() {
          evaluated = true;
          return ["secret"] as const;
        },
      },
    }),
  ).toThrow();
  expect(evaluated).toBe(false);
  expect(() =>
    createModel({ name: "Invalid", table, attributes: { unsafe: true } } as never),
  ).toThrow();
});

test("model names cannot invoke coercion hooks before validation", () => {
  let calls = 0;
  const name = {
    toString() {
      calls++;
      return "Unsafe";
    },
  } as unknown as string;
  expect(() => createModel({ name, table, attributes: {} })).toThrow("Model names");
  expect(calls).toBe(0);
});
