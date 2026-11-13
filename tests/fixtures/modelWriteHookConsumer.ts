/** Installed native consumer: definitions are composed before the owning app starts. */
import assert from "node:assert/strict";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel, defineRepository } from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; scope: string; label: string };
type Attributes = Record<string, unknown>;
class HookEntity extends Model<Row, "id"> {}
export function createModelWriteHookFixture() {
  const table = defineTable<Row, "id">({
    name: "rebinding_items",
    primaryKey: "id",
    columns: ["id", "scope", "label"],
  });
  const fixtures = [false, true].map((asynchronous) => {
    const inputs: Attributes[] = [];
    let fail = false;
    const repository = defineRepository({
      name: asynchronous ? "hook-async" : "hook-sync",
      table,
      dependencies: [],
      hooks: {
        hydrateRow: (row) =>
          typeof row.label === "string" && row.label.startsWith("stored:")
            ? { ...row, label: row.label.slice("stored:".length) }
            : { ...row },
      },
      create: (binding) => new BaseRepository(binding),
    });
    const model = defineModel({
      name: asynchronous ? "AsyncHookItem" : "SyncHookItem",
      repository,
      dependencies: [],
      attributes: {
        guarded: [],
        timestamps: false,
        dehydrate: (attributes) => {
          inputs.push({ ...attributes });
          const serialize = () => {
            if (fail) {
              fail = false;
              throw new Error("consumer serialization failure");
            }
            return "label" in attributes
              ? { ...attributes, label: `stored:${attributes.label}` }
              : { ...attributes };
          };
          return asynchronous ? Promise.resolve().then(serialize) : serialize();
        },
      },
      construct: (state, binding) => new HookEntity(state, binding),
    });
    return {
      asynchronous,
      inputs,
      repository,
      model,
      failNextWrite() {
        fail = true;
      },
    };
  });
  return {
    repositories: fixtures.map((fixture) => fixture.repository),
    models: fixtures.map((fixture) => fixture.model),
    async verify(database: DatabaseSession): Promise<void> {
      const placeholder = database.dialect.placeholder;
      const storedRow = async (id: number) => {
        const rows = await database.execute<Row>({
          text: `SELECT * FROM rebinding_items WHERE id = ${placeholder(1)}`,
          params: [id],
        });
        assert.ok(rows[0]);
        return rows[0];
      };
      for (const fixture of fixtures) {
        const { asynchronous, inputs } = fixture;
        const HookItem = database.model(fixture.model);
        const item = await HookItem.create({
          scope: asynchronous ? "hook-async" : "hook-sync",
          label: "created",
        });
        assert.equal(item.get("label"), "created");
        assert.equal((await storedRow(item.id)).label, "stored:created");
        assert.equal(inputs.length, 1);
        await item.save();
        assert.equal(inputs.length, 1, "No-op saves must not invoke the write hook.");
        await database.execute({
          text: `UPDATE rebinding_items SET scope = ${placeholder(1)} WHERE id = ${placeholder(2)}`,
          params: ["concurrently-updated", item.id],
        });
        await item.update({ label: "updated" });
        assert.deepEqual(inputs[1], { label: "updated" });
        assert.equal(item.get("label"), "updated");
        const persisted = await storedRow(item.id);
        assert.equal(persisted.id, item.id);
        assert.equal(persisted.scope, "concurrently-updated");
        assert.equal(persisted.label, "stored:updated");
        assert.deepEqual(Object.keys(persisted).sort(), ["id", "label", "scope"]);
        item.mergeAttributes({ label: "saved" });
        await item.save();
        assert.deepEqual(inputs[2], { label: "saved" });
        assert.equal((await storedRow(item.id)).label, "stored:saved");
        fixture.failNextWrite();
        await assert.rejects(item.update({ label: "retry" }), /consumer serialization failure/);
        assert.equal(item.get("label"), "retry");
        assert.equal((await storedRow(item.id)).label, "stored:saved");
        await item.save();
        assert.equal((await storedRow(item.id)).label, "stored:retry");
        await item.save();
        assert.equal(inputs.length, 5);
      }
    },
  };
}
