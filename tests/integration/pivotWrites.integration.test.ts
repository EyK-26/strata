import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  BaseRepository,
  type DatabaseConnection,
  type SqlDatabaseConnection,
} from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
} from "@getstrata/core/database/defaultConnection";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { Model, registerModelRepository } from "@getstrata/core/database/model";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { SQL } from "bun";

for (const dialect of ["pgsql", "mysql"] as const) {
  const url = dialect === "pgsql" ? process.env.MIGRATION_DATABASE_URL : process.env.MYSQL_URL;
  describe.skipIf(!url)(`real ${dialect} batched pivot writes`, () => {
    const table = `pivot_${crypto.randomUUID().replaceAll("-", "")}`;
    let db: DatabaseConnection;
    let close: () => Promise<void>;
    let previous: ReturnType<typeof getBoundDatabaseConnection>;
    let previousPool: SqlDatabaseConnection;
    class Tag extends Model<{ id: number }, "id"> {}
    class Owner extends Model<{ id: number }, "id"> {
      tags() {
        return this.belongsToMany(Tag, table, "user_id", "tag_id");
      }
    }
    beforeAll(async () => {
      if (!url) throw new Error("Dedicated test database URL required");
      if (dialect === "pgsql") {
        const pool = new SQL(url);
        db = pool as unknown as DatabaseConnection;
        close = () => pool.close();
      } else {
        const pool = createMysqlConnection(url);
        db = pool;
        close = () => pool.close();
      }
      previous = getBoundDatabaseConnection();
      previousPool = getDefaultDatabasePool();
      bindDatabaseConnection(db);
      await db.unsafe(
        `CREATE TABLE ${table} (user_id INTEGER NOT NULL, tag_id INTEGER NOT NULL CHECK(tag_id > 0), UNIQUE(user_id, tag_id))`,
      );
      for (const model of [Owner, Tag])
        registerModelRepository(
          model,
          new BaseRepository(
            defineTable<{ id: number }, "id">({ name: table, primaryKey: "id", columns: ["id"] }),
            db,
          ),
        );
    });
    afterAll(async () => {
      if (previous) bindDatabaseConnection(previous);
      else resetBoundDatabaseConnection();
      registerDefaultDatabasePool(previousPool);
      await db?.unsafe(`DROP TABLE IF EXISTS ${table}`);
      await close?.();
    });
    test("an explicitly registered default pool also preserves outer rollback", async () => {
      resetBoundDatabaseConnection();
      registerDefaultDatabasePool(db as SqlDatabaseConnection);
      try {
        await runWithSqlDialect(dialect, async () => {
          await db.unsafe(`DELETE FROM ${table}`);
          const owner = new Owner({ id: 1 }, Owner.repository());
          await expect(
            runInTransaction(async () => {
              await owner.tags().attach([10, 11]);
              await owner.tags().detach(10);
              throw new Error("registered rollback");
            }),
          ).rejects.toThrow("registered rollback");
          expect(await db.unsafe(`SELECT * FROM ${table}`)).toEqual([]);
        });
      } finally {
        registerDefaultDatabasePool(previousPool);
        bindDatabaseConnection(db);
      }
    });
    test("batch parameters, savepoint rollback, outer rollback and mixed ID toggles", async () => {
      await runWithSqlDialect(dialect, async () => {
        const owner = new Owner({ id: 1 }, Owner.repository());
        await owner.tags().attach([1, 2, 3]);
        await owner.tags().detach([2, 3]);
        await runInTransaction(async () => {
          await expect(owner.tags().toggle([1, -1])).rejects.toThrow();
          await owner.tags().attach(4);
        });
        expect(await db.unsafe(`SELECT tag_id FROM ${table} ORDER BY tag_id`)).toEqual([
          { tag_id: 1 },
          { tag_id: 4 },
        ]);
        await expect(
          runInTransaction(async () => {
            await owner.tags().attach([5, 6]);
            await owner.tags().detach(1);
            throw new Error("outer rollback");
          }),
        ).rejects.toThrow("outer rollback");
        expect(await db.unsafe(`SELECT tag_id FROM ${table} ORDER BY tag_id`)).toEqual([
          { tag_id: 1 },
          { tag_id: 4 },
        ]);
        await owner.tags().toggle([7, "7"]);
        expect(await db.unsafe(`SELECT tag_id FROM ${table} ORDER BY tag_id`)).toEqual([
          { tag_id: 1 },
          { tag_id: 4 },
        ]);
      });
    });
  });
}
