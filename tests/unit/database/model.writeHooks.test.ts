import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type BoundModel,
  defineModel,
  defineRepository,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = { id: number; name: string; qty: number };
type Attributes = Record<string, unknown>;
class Entity extends Model<Row, "id"> {}
async function withWriteHook(
  asynchronous: boolean,
  verify: (fixture: {
    Item: BoundModel<Row, "id", Entity>;
    storedRow: (id: number) => Promise<Row>;
    replaceQuantity: (id: number, qty: number) => Promise<unknown>;
    inputs: Attributes[];
    failNextWrite(): void;
  }) => Promise<void>,
) {
  const table = defineTable<Row, "id">({
    name: "write_hook_items",
    primaryKey: "id",
    columns: ["id", "name", "qty"],
  });
  const inputs: Attributes[] = [];
  let fail = false;
  const repository = defineRepository({
    name: "write_hook_items",
    table,
    dependencies: [],
    hooks: {
      hydrateRow: (row) =>
        typeof row.name === "string" && row.name.startsWith("stored:")
          ? { ...row, name: row.name.slice("stored:".length) }
          : { ...row },
    },
    create: (binding) => new BaseRepository(binding),
  });
  const definition = defineModel({
    name: "HookItem",
    repository,
    dependencies: [],
    attributes: {
      guarded: [],
      timestamps: false,
      dehydrate: (values) => {
        inputs.push({ ...values });
        const serialize = () => {
          if (fail) {
            fail = false;
            throw new Error("custom serialization failure");
          }
          return "name" in values ? { ...values, name: `stored:${values.name}` } : { ...values };
        };
        return asynchronous ? Promise.resolve().then(serialize) : serialize();
      },
    },
    construct: (state, binding) => new Entity(state, binding),
  });
  await withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        repositories: [repository],
        models: [definition],
      },
    },
    async (db) => {
      await db.execute({
        text: "CREATE TABLE write_hook_items(id INTEGER PRIMARY KEY,name TEXT NOT NULL,qty INTEGER NOT NULL)",
        params: [],
      });
      await verify({
        Item: db.model(definition),
        storedRow: async (id) => {
          const rows = await db.execute<Row>({
            text: "SELECT * FROM write_hook_items WHERE id = ?",
            params: [id],
          });
          if (!rows[0]) throw new Error("Missing stored row");
          return rows[0];
        },
        replaceQuantity: (id, qty) =>
          db.execute({
            text: "UPDATE write_hook_items SET qty = ? WHERE id = ?",
            params: [qty, id],
          }),
        inputs,
        failNextWrite: () => {
          fail = true;
        },
      });
    },
  );
}

for (const asynchronous of [false, true]) {
  const kind = asynchronous ? "async" : "sync";
  test(`${kind} explicit write hooks apply to create, dirty update and save without overwriting stale fields`, async () => {
    await withWriteHook(asynchronous, async ({ Item, storedRow, replaceQuantity, inputs }) => {
      const item = await Item.create({ name: "created", qty: 1 });
      expect(item.get("name")).toBe("created");
      expect((await storedRow(item.id)).name).toBe("stored:created");
      expect(inputs).toEqual([{ name: "created", qty: 1 }]);
      await item.save();
      expect(inputs).toHaveLength(1);

      await replaceQuantity(item.id, 5);
      await item.update({ name: "updated" });
      expect(inputs[1]).toEqual({ name: "updated" });
      expect(item.toObject()).toEqual({ id: item.id, name: "updated", qty: 5 });
      expect(await storedRow(item.id)).toEqual({
        id: item.id,
        name: "stored:updated",
        qty: 5,
      });

      item.mergeAttributes({ name: "saved" });
      await item.save();
      expect(inputs[2]).toEqual({ name: "saved" });
      expect((await storedRow(item.id)).name).toBe("stored:saved");
      await item.save();
      expect(inputs).toHaveLength(3);

      const unsaved = Item.newFromRecord({ name: "unsaved", qty: 2 }, false);
      expect(unsaved.$exists).toBe(false);
      await unsaved.save();
      expect(unsaved.$exists).toBe(true);
      expect(inputs[3]).toEqual({ name: "unsaved", qty: 2 });
      expect((await storedRow(unsaved.id)).name).toBe("stored:unsaved");
    });
  });

  test(`${kind} explicit write failure prevents SQL and keeps the same instance retryable`, async () => {
    await withWriteHook(asynchronous, async ({ Item, storedRow, inputs, failNextWrite }) => {
      const item = await Item.create({ name: "original", qty: 1 });
      failNextWrite();
      await expect(item.update({ qty: 7 })).rejects.toThrow("custom serialization failure");
      expect(item.get("qty")).toBe(7);
      expect(await storedRow(item.id)).toEqual({
        id: item.id,
        name: "stored:original",
        qty: 1,
      });
      await item.save();
      expect(inputs).toEqual([{ name: "original", qty: 1 }, { qty: 7 }, { qty: 7 }]);
      expect(await storedRow(item.id)).toEqual({
        id: item.id,
        name: "stored:original",
        qty: 7,
      });
      await item.save();
      expect(inputs).toHaveLength(3);
    });
  });
}
