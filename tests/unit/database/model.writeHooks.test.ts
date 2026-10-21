import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; name: string; qty: number };
type Attributes = Record<string, unknown>;

async function withWriteHook(
  asynchronous: boolean,
  verify: (fixture: {
    Item: typeof Model<Row, "id">;
    repository: BaseRepository<Row, "id">;
    inputs: Attributes[];
    failNextWrite(): void;
  }) => Promise<void>,
): Promise<void> {
  const connection = createSqliteConnection(":memory:");
  const table = defineTable<Row, "id">({
    name: "write_hook_items",
    primaryKey: "id",
    columns: ["id", "name", "qty"],
  });
  const repository = new BaseRepository(table, connection);
  const inputs: Attributes[] = [];
  let fail = false;
  class HookItem extends Model<Row, "id"> {
    static override $guarded = [];
    static override $timestamps = false;

    protected static override hydrateAttributes<T extends object>(attributes: T): T {
      const hydrated = Model.hydrateAttributes(attributes);
      return "name" in hydrated &&
        typeof hydrated.name === "string" &&
        hydrated.name.startsWith("stored:")
        ? { ...hydrated, name: hydrated.name.slice("stored:".length) }
        : hydrated;
    }

    protected static override dehydrateAttributes(
      attributes: Attributes,
    ): Attributes | Promise<Attributes> {
      inputs.push({ ...attributes });
      const serialize = () => {
        if (fail) {
          fail = false;
          throw new Error("custom serialization failure");
        }
        return "name" in attributes
          ? { ...attributes, name: `stored:${attributes.name}` }
          : { ...attributes };
      };
      return asynchronous ? Promise.resolve().then(serialize) : serialize();
    }
  }
  try {
    useSqlDialect("sqlite");
    // Fixture schema only; all application writes and reads below use the ORM.
    await connection.unsafe(
      "CREATE TABLE write_hook_items(id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER NOT NULL)",
    );
    registerModelRepository(HookItem, repository);
    await verify({
      Item: HookItem,
      repository,
      inputs,
      failNextWrite: () => {
        fail = true;
      },
    });
  } finally {
    resetSqlDialect();
    await connection.close();
  }
}

for (const asynchronous of [false, true]) {
  const kind = asynchronous ? "async" : "sync";
  test(`${kind} protected write hooks apply to create, dirty update and save without overwriting stale fields`, async () => {
    await withWriteHook(asynchronous, async ({ Item, repository, inputs }) => {
      const item = await Item.create({ name: "created", qty: 1 });
      expect(item.get("name")).toBe("created");
      expect((await repository.findByIdOrThrow(item.id)).name).toBe("stored:created");
      expect(inputs).toEqual([{ name: "created", qty: 1 }]);
      await item.save();
      expect(inputs).toHaveLength(1);

      await repository.updateByIdOrThrow(item.id, { qty: 5 });
      await item.update({ name: "updated" });
      expect(inputs[1]).toEqual({ name: "updated" });
      expect(item.toObject()).toEqual({ id: item.id, name: "updated", qty: 5 });
      expect(await repository.findByIdOrThrow(item.id)).toEqual({
        id: item.id,
        name: "stored:updated",
        qty: 5,
      });

      item.mergeAttributes({ name: "saved" });
      await item.save();
      expect(inputs[2]).toEqual({ name: "saved" });
      expect((await repository.findByIdOrThrow(item.id)).name).toBe("stored:saved");
      await item.save();
      expect(inputs).toHaveLength(3);

      const unsaved = Item.newFromRecord({ name: "unsaved", qty: 2 }, false);
      expect(unsaved.$exists).toBe(false);
      await unsaved.save();
      expect(unsaved.$exists).toBe(true);
      expect(inputs[3]).toEqual({ name: "unsaved", qty: 2 });
      expect((await repository.findByIdOrThrow(unsaved.id)).name).toBe("stored:unsaved");
    });
  });

  test(`${kind} protected write failure prevents SQL and keeps the same instance retryable`, async () => {
    await withWriteHook(asynchronous, async ({ Item, repository, inputs, failNextWrite }) => {
      const item = await Item.create({ name: "original", qty: 1 });
      failNextWrite();
      await expect(item.update({ qty: 7 })).rejects.toThrow("custom serialization failure");
      expect(item.get("qty")).toBe(7);
      expect(await repository.findByIdOrThrow(item.id)).toEqual({
        id: item.id,
        name: "stored:original",
        qty: 1,
      });
      await item.save();
      expect(inputs).toEqual([{ name: "original", qty: 1 }, { qty: 7 }, { qty: 7 }]);
      expect(await repository.findByIdOrThrow(item.id)).toEqual({
        id: item.id,
        name: "stored:original",
        qty: 7,
      });
      await item.save();
      expect(inputs).toHaveLength(3);
    });
  });
}
