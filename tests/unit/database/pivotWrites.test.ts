import { test as bunTest, describe, expect } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

class PivotTag extends Model<{ id: number }, "id"> {}
class PivotUser extends Model<{ id: number }, "id"> {
  tags() {
    return this.belongsToMany(tagDefinition, "pivot_links", "user_id", "tag_id");
  }
}
const tags = defineRepository({
  name: "pivot.tags",
  table: defineTable<{ id: number }, "id">({
    name: "pivot_tags",
    primaryKey: "id",
    columns: ["id"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const users = defineRepository({
  name: "pivot.users",
  table: defineTable<{ id: number }, "id">({
    name: "pivot_users",
    primaryKey: "id",
    columns: ["id"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const tagDefinition = defineModel({
  name: "PivotTag",
  repository: tags,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new PivotTag(state, binding),
});
const userDefinition = defineModel({
  name: "PivotUser",
  repository: users,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new PivotUser(state, binding),
});
async function withFixture(
  work: (ports: {
    database: DatabaseSession;
    invoke: import("../../helpers/boundRepositoryHarness").DatabaseInvocation;
    db: { unsafe: <T>(text: string, params?: readonly unknown[]) => Promise<readonly T[]> };
    user: (explicit: boolean, selected?: DatabaseSession | TransactionSession) => PivotUser;
  }) => unknown,
) {
  return withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: {
          main: { driver: "sqlite", filename: ":memory:" },
          custom: { driver: "sqlite", filename: ":memory:" },
        },
        repositories: [tags, users],
        models: [tagDefinition, userDefinition],
      },
    },
    async (database, invoke) => {
      const db = {
        unsafe: <T>(text: string, params: readonly unknown[] = []) =>
          database.execute<T>({ text, params }),
      };
      await db.unsafe(
        "CREATE TABLE pivot_links (user_id INTEGER, tag_id INTEGER CHECK(tag_id > 0), UNIQUE(user_id, tag_id))",
      );
      await database
        .connection("custom")
        .execute({ text: "CREATE TABLE pivot_links (user_id INTEGER,tag_id INTEGER)", params: [] });
      const user = (
        explicit: boolean,
        selected: DatabaseSession | TransactionSession = explicit
          ? database.connection("main")
          : database,
      ) => selected.model(userDefinition).hydrate({ id: 1 });
      await work({ database, invoke, db, user });
    },
  );
}
function test(name: string, work: Parameters<typeof withFixture>[0]) {
  bunTest(name, () => withFixture(work));
}
describe("transactional pivot writes", () => {
  for (const explicit of [false, true]) {
    test(`nested pivot operations preserve the outer transaction (${explicit ? "explicit" : "default"})`, async ({
      database,
      user,
      db,
    }) => {
      await (async () => {
        await expect(
          database.transaction(async (transaction) => {
            const model = user(explicit, transaction);
            await model.tags().attach([1, 2]);
            await model.tags().toggle([1, 3]);
            throw new Error("outer rollback");
          }),
        ).rejects.toThrow("outer rollback");
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
      })();
    });
    test(`caught toggle failure rolls back its deletion (${explicit ? "explicit" : "default"})`, async ({
      database,
      user,
      db,
    }) => {
      await (async () => {
        const model = user(explicit);
        await model.tags().attach(1);
        await database.transaction(async (transaction) => {
          const model = user(explicit, transaction);
          await expect(model.tags().toggle([1, -1])).rejects.toThrow();
          await model.tags().attach(2);
        });
        expect(await db.unsafe("SELECT tag_id FROM pivot_links ORDER BY tag_id")).toEqual([
          { tag_id: 1 },
          { tag_id: 2 },
        ]);
      })();
    });
  }
  test("equivalent numeric/string/bigint IDs retain sequential toggle semantics", async ({
    user,
    db,
  }) => {
    await (async () => {
      const model = user(true);
      await model.tags().toggle([2, "2"]);
      expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
      await model.tags().toggle([2n, "2", 2]);
      expect(await db.unsafe("SELECT tag_id FROM pivot_links")).toEqual([{ tag_id: 2 }]);
    })();
  });
  test("empty writes do not open transactions and duplicate attach rolls back", async ({
    user,
    db,
  }) => {
    await (async () => {
      const model = user(true);
      await model.tags().attach([]);
      await model.tags().detach([]);
      await model.tags().toggle([]);
      await expect(model.tags().attach([1, 1])).rejects.toThrow();
      expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
    })();
  });
  test("integer coercions are compared by the database, including existing links", async ({
    user,
    db,
  }) => {
    await (async () => {
      const model = user(true);
      for (const alias of ["02", "+2", "2.0", " 2 ", "2e0"]) {
        await model.tags().toggle([2, alias]);
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
        await model.tags().attach(2);
        await model.tags().toggle(alias);
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
      }
    })();
  });
  test("text IDs retain distinct padding and database collation semantics", async ({
    user,
    db,
  }) => {
    await (async () => {
      await db.unsafe("DROP TABLE pivot_links");
      await db.unsafe(
        "CREATE TABLE pivot_links (user_id INTEGER, tag_id TEXT COLLATE NOCASE, UNIQUE(user_id, tag_id))",
      );
      const model = user(true);
      await model.tags().toggle(["2", "02"]);
      expect(await db.unsafe("SELECT tag_id FROM pivot_links ORDER BY tag_id")).toEqual([
        { tag_id: "02" },
        { tag_id: "2" },
      ]);
      await model.tags().toggle(["alpha", "ALPHA"]);
      expect(await db.unsafe("SELECT tag_id FROM pivot_links ORDER BY tag_id")).toEqual([
        { tag_id: "02" },
        { tag_id: "2" },
      ]);
    })();
  });
  test("an independent configured repository keeps its own connection", async ({
    database,
    invoke,
    user,
    db,
  }) => {
    const custom = database.connection("custom");
    await expect(
      database.transaction(async () => {
        await invoke(async (independent) => {
          const independentModel = user(true, independent.connection("custom"));
          await independentModel.tags().attach([1, 2]);
          await independentModel.tags().detach(2);
        });
        throw Error("configured rollback");
      }),
    ).rejects.toThrow("configured rollback");
    expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
    expect(await custom.execute({ text: "SELECT * FROM pivot_links", params: [] })).toEqual([
      { user_id: 1, tag_id: 1 },
    ]);
  });
});
