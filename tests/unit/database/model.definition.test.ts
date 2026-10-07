import { afterEach, describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { runWithDatabaseConnection } from "@getstrata/core/database/connectionContext";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import {
  bootModels,
  defineModel,
  Model,
  registerModelRepository,
} from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";

interface Record {
  sku: string;
  title: string;
}
const table = defineTable<Record, "sku">({
  name: "definition_products",
  primaryKey: "sku",
  columns: ["sku", "title"],
});
const connections: Array<ReturnType<typeof createSqliteConnection>> = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  resetBoundDatabaseConnection();
  resetSqlDialect();
});
async function database() {
  const connection = createSqliteConnection(":memory:");
  connections.push(connection);
  useSqlDialect("sqlite");
  await connection.unsafe(
    "CREATE TABLE definition_products (sku TEXT PRIMARY KEY, title TEXT NOT NULL)",
  );
  return connection;
}

describe("declarative model repositories", () => {
  test("lazily binds once per concrete subclass without opening a database", () => {
    class DefinedProduct extends defineModel(table) {}
    class FeaturedProduct extends DefinedProduct {}
    const repository = DefinedProduct.repository<Record, "sku">();
    expect(repository.getTable()).toBe(table);
    expect(DefinedProduct.repository<Record, "sku">()).toBe(repository);
    expect(FeaturedProduct.repository<Record, "sku">()).not.toBe(repository);
    expect(FeaturedProduct.repository<Record, "sku">().getTable()).toBe(table);
  });

  test("preserves concrete models, non-id primary keys and active transaction rollback", async () => {
    const connection = await database();
    bindDatabaseConnection(connection);
    class DefinedProduct extends defineModel(table) {
      static override $fillable = ["sku", "title"];
      static override $timestamps = false;
      label() {
        return this.get("title");
      }
    }
    const saved = await DefinedProduct.create({ sku: "first", title: "book" });
    expect(saved).toBeInstanceOf(DefinedProduct);
    expect(saved.id).toBe("first");
    expect(saved.label()).toBe("book");
    await expect(
      runInTransaction(async () => {
        await DefinedProduct.create({ sku: "rollback", title: "rollback" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await DefinedProduct.find("rollback")).toBeNull();
    expect((await DefinedProduct.findOrFail("first")).label()).toBe("book");
  });

  test("one cached repository follows concurrent request connections", async () => {
    const first = await database();
    const second = await database();
    bindDatabaseConnection(first);
    await first.unsafe("INSERT INTO definition_products VALUES ('shared', 'first tenant')");
    await second.unsafe("INSERT INTO definition_products VALUES ('shared', 'second tenant')");
    class ScopedProduct extends defineModel(table) {}
    ScopedProduct.repository<Record, "sku">();
    const results = await Promise.all([
      runWithDatabaseConnection(first, async () => {
        await Bun.sleep(5);
        return (await ScopedProduct.findOrFail("shared")).get("title");
      }),
      runWithDatabaseConnection(second, async () =>
        (await ScopedProduct.findOrFail("shared")).get("title"),
      ),
    ]);
    expect(results).toEqual(["first tenant", "second tenant"]);
  });

  test("explicit custom repositories override defaults before or after initialization", () => {
    class CustomRepository extends BaseRepository<Record, "sku"> {}
    class CustomProduct extends defineModel(table) {}
    const custom = new CustomRepository(table);
    registerModelRepository(CustomProduct, custom);
    bootModels([CustomProduct]);
    expect(CustomProduct.repository<Record, "sku">()).toBe(custom);
    const replacement = new CustomRepository(table);
    registerModelRepository(CustomProduct, replacement);
    expect(CustomProduct.repository<Record, "sku">()).toBe(replacement);
    class LateProduct extends defineModel(table) {}
    LateProduct.repository<Record, "sku">();
    registerModelRepository(LateProduct, replacement);
    expect(LateProduct.repository<Record, "sku">()).toBe(replacement);
  });

  test("boots once and makes all names and morph aliases available before hooks", () => {
    let boots = 0;
    class DefinitionChild extends defineModel(table) {
      static override $morphClass = "definition-child";
    }
    class DefinitionParent extends defineModel(table) {
      static override boot() {
        boots++;
        DefinitionParent.newFromRecord({ sku: "parent", title: "parent" }).hasMany(
          "definition-child",
        );
      }
    }
    bootModels([DefinitionParent, DefinitionChild]);
    bootModels([DefinitionParent, DefinitionChild]);
    DefinitionParent.query();
    expect(boots).toBe(1);
  });

  test("failed boot remains a startup failure and can be retried", () => {
    let attempts = 0;
    let scopes = 0;
    class RetriedProduct extends defineModel(table) {
      static override boot() {
        RetriedProduct.addGlobalScope("retry", (query) => {
          scopes++;
          return query;
        });
        if (++attempts === 1) throw new Error("boot failed");
      }
    }
    expect(() => bootModels([RetriedProduct])).toThrow("boot failed");
    bootModels([RetriedProduct]);
    expect(attempts).toBe(2);
    RetriedProduct.query();
    expect(scopes).toBe(1);
  });

  test("legacy explicit bindings still work and missing definitions fail clearly", () => {
    class LegacyProduct extends Model<Record, "sku"> {}
    expect(() => LegacyProduct.repository<Record, "sku">()).toThrow(
      "repository() is not implemented",
    );
    const repository = new BaseRepository(table);
    registerModelRepository(LegacyProduct, repository);
    expect(LegacyProduct.repository<Record, "sku">()).toBe(repository);
  });
});
