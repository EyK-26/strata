import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Row = { id: number; reference: string; status: string };
for (const asynchronous of [false, true])
  for (const forced of [false, true]) {
    test(`create does not mutate ${asynchronous ? "async" : "sync"} protected write outputs (${forced ? "forced" : "ordinary"} fields)`, async () => {
      const db = createSqliteConnection(":memory:");
      const table = defineTable<Row, "id">({
        name: "immutable_writes",
        primaryKey: "id",
        columns: ["id", "reference", "status"],
      });
      const results: Readonly<Record<string, unknown>>[] = [];
      class Item extends Model<Row, "id"> {
        static override $guarded = [];
        static override $timestamps = false;
        protected static override dehydrateAttributes(attributes: Record<string, unknown>) {
          const output = Object.freeze({
            ...attributes,
            status: attributes.status ?? "derived-status",
            ...("reference" in attributes ? { reference: `stored:${attributes.reference}` } : {}),
          });
          results.push(output);
          return asynchronous ? Promise.resolve(output) : output;
        }
      }
      const repository = new BaseRepository(table, db);
      registerModelRepository(Item, repository);
      Item.observe({
        creating(model) {
          model.mergeAttributes(forced ? { reference: "edited" } : { status: "edited" });
        },
      });
      try {
        await runWithSqlDialect("sqlite", async () => {
          // Fixture schema only; the write and reload use the public ORM.
          await db.unsafe(
            "CREATE TABLE immutable_writes(id INTEGER PRIMARY KEY,reference TEXT,status TEXT)",
          );
          const item = await Item.create(
            { reference: "input", status: "initial" },
            forced ? { status: "trusted" } : {},
          );
          const stored = await repository.findByIdOrThrow(item.id);
          expect(stored.reference).toBe(forced ? "stored:edited" : "stored:input");
          expect(stored.status).toBe(forced ? "trusted" : "edited");
          expect(results).toHaveLength(2);
          expect(results.every(Object.isFrozen)).toBe(true);
          expect(results[0]?.status).toBe(forced ? "trusted" : "initial");
          expect(results[1]?.status).toBe(forced ? "derived-status" : "edited");
        });
      } finally {
        await db.close();
      }
    });
  }
