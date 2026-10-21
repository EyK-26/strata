/** Installed native consumer: use the app's migrated table and framework ORM only. */
import assert from "node:assert/strict";
import type { BaseRepository } from "@getstrata/core/database/baseRepository";
import { Model, registerModelRepository } from "@getstrata/core/database/model";

type Row = { id: number; scope: string; label: string };
type Attributes = Record<string, unknown>;

export async function verifyModelWriteHooks(repository: BaseRepository<Row, "id">): Promise<void> {
  for (const asynchronous of [false, true]) {
    const inputs: Attributes[] = [];
    let fail = false;
    class HookItem extends Model<Row, "id"> {
      static override $guarded = [];
      static override $timestamps = false;

      protected static override hydrateAttributes<T extends object>(attributes: T): T {
        const hydrated = Model.hydrateAttributes(attributes);
        return "label" in hydrated &&
          typeof hydrated.label === "string" &&
          hydrated.label.startsWith("stored:")
          ? { ...hydrated, label: hydrated.label.slice("stored:".length) }
          : hydrated;
      }

      protected static override dehydrateAttributes(
        attributes: Attributes,
      ): Attributes | Promise<Attributes> {
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
      }
    }
    registerModelRepository(HookItem, repository);
    const item = await HookItem.create({
      scope: asynchronous ? "hook-async" : "hook-sync",
      label: "created",
    });
    assert.equal(item.get("label"), "created");
    assert.equal((await repository.findByIdOrThrow(item.id)).label, "stored:created");
    assert.equal(inputs.length, 1);
    await item.save();
    assert.equal(inputs.length, 1, "No-op saves must not invoke the write hook.");

    await repository.updateByIdOrThrow(item.id, { scope: "concurrently-updated" });
    await item.update({ label: "updated" });
    assert.deepEqual(inputs[1], { label: "updated" });
    assert.equal(item.get("label"), "updated");
    const persisted = await repository.findByIdOrThrow(item.id);
    assert.equal(persisted.id, item.id);
    assert.equal(persisted.scope, "concurrently-updated");
    assert.equal(persisted.label, "stored:updated");
    assert.deepEqual(Object.keys(persisted).sort(), ["id", "label", "scope"]);

    item.mergeAttributes({ label: "saved" });
    await item.save();
    assert.deepEqual(inputs[2], { label: "saved" });
    assert.equal((await repository.findByIdOrThrow(item.id)).label, "stored:saved");
    fail = true;
    await assert.rejects(item.update({ label: "retry" }), /consumer serialization failure/);
    assert.equal(item.get("label"), "retry");
    assert.equal((await repository.findByIdOrThrow(item.id)).label, "stored:saved");
    await item.save();
    assert.equal((await repository.findByIdOrThrow(item.id)).label, "stored:retry");
    await item.save();
    assert.equal(inputs.length, 5);
  }
}
