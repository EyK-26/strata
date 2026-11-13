import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import {
  createNativePersistenceApplication,
  sessionSql,
} from "../helpers/nativePersistenceApplication";

for (const dialect of ["pgsql", "mysql"] as const) {
  const url = dialect === "pgsql" ? process.env.MIGRATION_DATABASE_URL : process.env.MYSQL_URL;
  describe.skipIf(!url)(`real ${dialect} batched pivot writes`, () => {
    const table = `pivot_${crypto.randomUUID().replaceAll("-", "")}`;
    class Tag extends Model<{ id: number }, "id"> {}
    class Owner extends Model<{ id: number }, "id"> {
      tags() {
        return this.belongsToMany(tagDefinition, table, "user_id", "tag_id");
      }
    }
    const repository = defineRepository({
      name: "pivot.repository",
      table: defineTable<{ id: number }, "id">({ name: table, primaryKey: "id", columns: ["id"] }),
      dependencies: [] as const,
      create: (binding) => new BaseRepository(binding),
    });
    const tagDefinition = defineModel({
      name: "Tag",
      repository,
      dependencies: [] as const,
      attributes: {},
      construct: (state, binding) => new Tag(state, binding),
    });
    const ownerDefinition = defineModel({
      name: "Owner",
      repository,
      dependencies: [] as const,
      attributes: {},
      construct: (state, binding) => new Owner(state, binding),
    });
    const owner = (database: DatabaseSession | TransactionSession) =>
      database.model(ownerDefinition).hydrate({ id: 1 });
    let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
    beforeAll(async () => {
      if (!url) throw Error("Dedicated test database URL required");
      native = await createNativePersistenceApplication({
        default: "test",
        connections: { test: { driver: dialect, url } },
        repositories: [repository],
        models: [tagDefinition, ownerDefinition],
      });
      await native.run((database) =>
        database.execute({
          text: `CREATE TABLE ${table} (user_id INTEGER NOT NULL,tag_id INTEGER NOT NULL CHECK(tag_id > 0),UNIQUE(user_id,tag_id))`,
          params: [],
        }),
      );
    });
    afterAll(async () => {
      try {
        await native?.run((database) =>
          database.execute({ text: `DROP TABLE IF EXISTS ${table}`, params: [] }),
        );
      } finally {
        await native?.close();
      }
    });
    test("an explicitly selected configured pool also preserves outer rollback", () =>
      native.run(async (database) => {
        const selected = database.connection("test");
        const db = sessionSql(selected);
        await db.unsafe(`DELETE FROM ${table}`);
        await expect(
          selected.transaction(async (transaction) => {
            const model = owner(transaction);
            await model.tags().attach([10, 11]);
            await model.tags().detach(10);
            throw Error("registered rollback");
          }),
        ).rejects.toThrow("registered rollback");
        expect(await db.unsafe(`SELECT * FROM ${table}`)).toEqual([]);
      }));
    test("batch parameters, savepoint rollback, outer rollback and mixed ID toggles", () =>
      native.run(async (database) => {
        const model = owner(database);
        const db = sessionSql(database);
        await model.tags().attach([1, 2, 3]);
        await model.tags().detach([2, 3]);
        await database.transaction(async (transaction) => {
          const child = owner(transaction);
          await expect(child.tags().toggle([1, -1])).rejects.toThrow();
          await child.tags().attach(4);
        });
        expect(await db.unsafe(`SELECT tag_id FROM ${table} ORDER BY tag_id`)).toEqual([
          { tag_id: 1 },
          { tag_id: 4 },
        ]);
        await expect(
          database.transaction(async (transaction) => {
            const child = owner(transaction);
            await child.tags().attach([5, 6]);
            await child.tags().detach(1);
            throw Error("outer rollback");
          }),
        ).rejects.toThrow("outer rollback");
        expect(await db.unsafe(`SELECT tag_id FROM ${table} ORDER BY tag_id`)).toEqual([
          { tag_id: 1 },
          { tag_id: 4 },
        ]);
        await model.tags().toggle([7, "7"]);
        await model.tags().toggle([8, "08"]);
        await model.tags().attach(9);
        await model.tags().toggle("09");
        expect(await db.unsafe(`SELECT tag_id FROM ${table} ORDER BY tag_id`)).toEqual([
          { tag_id: 1 },
          { tag_id: 4 },
        ]);
      }));
  });
}
