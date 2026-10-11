import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";

describe("transactional pivot writes", () => {
  let db: ReturnType<typeof createSqliteConnection>;
  beforeEach(async () => {
    db = createSqliteConnection(":memory:");
    bindDatabaseConnection(db);
    await db.unsafe(
      "CREATE TABLE pivot_links (user_id INTEGER, tag_id INTEGER CHECK(tag_id > 0), UNIQUE(user_id, tag_id))",
    );
  });
  afterEach(() => {
    resetBoundDatabaseConnection();
    db.close();
  });
  function user(explicit: boolean, connection = db) {
    class PivotTag extends Model<{ id: number }, "id"> {}
    class PivotUser extends Model<{ id: number }, "id"> {
      tags() {
        return this.belongsToMany(PivotTag, "pivot_links", "user_id", "tag_id");
      }
    }
    registerModelRepository(
      PivotTag,
      new BaseRepository(
        defineTable<{ id: number }, "id">({
          name: "pivot_tags",
          primaryKey: "id",
          columns: ["id"],
        }),
        explicit ? connection : undefined,
      ),
    );
    registerModelRepository(
      PivotUser,
      new BaseRepository(
        defineTable<{ id: number }, "id">({
          name: "pivot_users",
          primaryKey: "id",
          columns: ["id"],
        }),
        explicit ? connection : undefined,
      ),
    );
    return new PivotUser({ id: 1 }, PivotUser.repository());
  }
  for (const explicit of [false, true]) {
    test(`nested pivot operations preserve the outer transaction (${explicit ? "explicit" : "default"})`, async () => {
      await runWithSqlDialect("sqlite", async () => {
        const model = user(explicit);
        await expect(
          runInTransaction(async () => {
            await model.tags().attach([1, 2]);
            await model.tags().toggle([1, 3]);
            throw new Error("outer rollback");
          }),
        ).rejects.toThrow("outer rollback");
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
      });
    });
    test(`caught toggle failure rolls back its deletion (${explicit ? "explicit" : "default"})`, async () => {
      await runWithSqlDialect("sqlite", async () => {
        const model = user(explicit);
        await model.tags().attach(1);
        await runInTransaction(async () => {
          await expect(model.tags().toggle([1, -1])).rejects.toThrow();
          await model.tags().attach(2);
        });
        expect(await db.unsafe("SELECT tag_id FROM pivot_links ORDER BY tag_id")).toEqual([
          { tag_id: 1 },
          { tag_id: 2 },
        ]);
      });
    });
  }
  test("equivalent numeric/string/bigint IDs retain sequential toggle semantics", async () => {
    await runWithSqlDialect("sqlite", async () => {
      const model = user(true);
      await model.tags().toggle([2, "2"]);
      expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
      await model.tags().toggle([2n, "2", 2]);
      expect(await db.unsafe("SELECT tag_id FROM pivot_links")).toEqual([{ tag_id: 2 }]);
    });
  });
  test("empty writes do not open transactions and duplicate attach rolls back", async () => {
    await runWithSqlDialect("sqlite", async () => {
      const model = user(true);
      await model.tags().attach([]);
      await model.tags().detach([]);
      await model.tags().toggle([]);
      await expect(model.tags().attach([1, 1])).rejects.toThrow();
      expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
    });
  });
  test("integer coercions are compared by the database, including existing links", async () => {
    await runWithSqlDialect("sqlite", async () => {
      const model = user(true);
      for (const alias of ["02", "+2", "2.0", " 2 ", "2e0"]) {
        await model.tags().toggle([2, alias]);
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
        await model.tags().attach(2);
        await model.tags().toggle(alias);
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
      }
    });
  });
  test("text IDs retain distinct padding and database collation semantics", async () => {
    await runWithSqlDialect("sqlite", async () => {
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
    });
  });
  test("an independent custom repository keeps its own connection", async () => {
    const custom = createSqliteConnection(":memory:");
    try {
      await custom.unsafe("CREATE TABLE pivot_links (user_id INTEGER, tag_id INTEGER)");
      await runWithSqlDialect("sqlite", async () => {
        const model = user(true, custom);
        await expect(
          runInTransaction(async () => {
            await model.tags().attach([1, 2]);
            await model.tags().detach(2);
            throw new Error("configured rollback");
          }),
        ).rejects.toThrow("configured rollback");
        expect(await db.unsafe("SELECT * FROM pivot_links")).toEqual([]);
        expect(await custom.unsafe("SELECT * FROM pivot_links")).toEqual([
          { user_id: 1, tag_id: 1 },
        ]);
      });
    } finally {
      custom.close();
    }
  });
});
