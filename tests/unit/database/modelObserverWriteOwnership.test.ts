import { expect, test } from "bun:test";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  defineModel,
  defineRepository,
  type ModelObserver,
} from "@getstrata/core/database/definitions";
import { Model } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

type Row = { id: number; reference: string; status: string };
class Entity extends Model<Row, "id"> {}
for (const asynchronous of [false, true])
  for (const forced of [false, true]) {
    test(`create does not mutate ${asynchronous ? "async" : "sync"} explicit write outputs (${forced ? "forced" : "ordinary"} fields)`, async () => {
      const table = defineTable<Row, "id">({
        name: "immutable_writes",
        primaryKey: "id",
        columns: ["id", "reference", "status"],
      });
      const results: Readonly<Record<string, unknown>>[] = [];
      const repository = defineRepository({
        name: "immutable_writes",
        table,
        dependencies: [],
        create: (binding) => new BaseRepository(binding),
      });
      const Observer = createServiceToken<ModelObserver<Entity>>("immutable-observer");
      const definition = defineModel({
        name: "Item",
        repository,
        dependencies: [],
        attributes: {
          guarded: [],
          timestamps: false,
          dehydrate: (attributes) => {
            const output = Object.freeze({
              ...attributes,
              status: attributes.status ?? "derived-status",
              ...("reference" in attributes ? { reference: `stored:${attributes.reference}` } : {}),
            });
            results.push(output);
            return asynchronous ? Promise.resolve(output) : output;
          },
        },
        observers: [Observer],
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
          services: [
            valueService(Observer, {
              creating: (model) => {
                model.mergeAttributes(forced ? { reference: "edited" } : { status: "edited" });
              },
            }),
          ],
        },
        async (db) => {
          await db.execute({
            text: "CREATE TABLE immutable_writes(id INTEGER PRIMARY KEY,reference TEXT,status TEXT)",
            params: [],
          });
          const item = await db
            .model(definition)
            .create({ reference: "input", status: "initial" }, forced ? { status: "trusted" } : {});
          const stored = await db.repository(repository).findByIdOrThrow(item.id);
          expect(stored.reference).toBe(forced ? "stored:edited" : "stored:input");
          expect(stored.status).toBe(forced ? "trusted" : "edited");
          // Explicit repository serialization consumes the final model intent exactly
          // once. Observer edits and trusted field priority are already resolved.
          expect(results).toHaveLength(2);
          expect(results.every(Object.isFrozen)).toBe(true);
          expect(results[0]?.status).toBe(forced ? "trusted" : "initial");
          expect(results[1]?.status).toBe(forced ? "derived-status" : "edited");
        },
      );
    });
  }
