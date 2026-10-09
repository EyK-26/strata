import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BaseRepository,
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
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";

const url = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const name = `write_probe_${crypto.randomUUID().replaceAll("-", "")}`;
const table = defineTable<{ id: number; tenant_id: number; stock: number }, "id">({
  name,
  primaryKey: "id",
  columns: ["id", "tenant_id", "stock"],
});
class Stock extends defineModel(table) {}
Stock.$timestamps = false;
Stock.$fillable = ["stock"];
describe.skipIf(!url || !adminUrl)("Postgres conditional writes under restricted-role RLS", () => {
  let owner: SQL;
  let pool: SQL;
  let previous: SqlDatabaseConnection;
  let bound: ReturnType<typeof getBoundDatabaseConnection>;
  let tenancy: string | undefined;
  beforeAll(async () => {
    previous = getDefaultDatabasePool();
    bound = getBoundDatabaseConnection();
    tenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    owner = new SQL(adminUrl!);
    pool = new SQL({ url: url!, max: 5 });
    const [role] = await pool.unsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    );
    expect(role!.rolsuper || role!.rolbypassrls).toBe(false);
    await owner.unsafe(
      `CREATE TABLE ${name} (id INTEGER NOT NULL,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL,PRIMARY KEY (id,tenant_id)); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_scope ON ${name} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer); GRANT SELECT,UPDATE,DELETE ON ${name} TO strata_app; INSERT INTO ${name} VALUES (1,1,10),(1,2,20)`,
    );
    registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
    resetBoundDatabaseConnection();
  });
  beforeEach(async () => {
    await owner.unsafe(`UPDATE ${name} SET stock=tenant_id*10`);
  });
  afterAll(async () => {
    if (previous) registerDefaultDatabasePool(previous);
    if (bound) bindDatabaseConnection(bound);
    else resetBoundDatabaseConnection();
    if (tenancy === undefined) delete process.env.TENANCY_DRIVER;
    else process.env.TENANCY_DRIVER = tenancy;
    try {
      await owner?.unsafe(`DROP TABLE IF EXISTS ${name}`);
    } finally {
      await pool?.close();
      await owner?.close();
    }
  });
  const scope = <T>(id: number, work: () => Promise<T>) =>
    runWithSqlDialect("pgsql", () => runWithTenantDatabase({ id, slug: `lock-${id}` }, work));
  const repo = new BaseRepository(table);
  test("competing conditional buyers admit one writer and enforce RLS", async () => {
    const counts = await Promise.all([
      scope(1, () => repo.query().where({ id: 1, stock: 10 }).update({ stock: 9 })),
      scope(1, () => repo.query().where({ id: 1, stock: 10 }).update({ stock: 9 })),
    ]);
    expect(counts.sort()).toEqual([0, 1]);
    await scope(1, async () => {
      expect(await repo.query().where({ tenant_id: 2 }).update({ stock: 0 })).toBe(0);
      expect(
        await repo.query().where({ id: 1, stock: 9 }).updateReturning({ stock: 8 }, "id", "stock"),
      ).toEqual([{ id: 1, stock: 8 }]);
    });
    await scope(2, async () => expect((await repo.findById(1))?.stock).toBe(20));
  });
  test("a failed transaction rolls back a set-based write", async () => {
    await expect(
      scope(1, async () => {
        expect(await repo.query().where({ id: 1 }).update({ stock: 0 })).toBe(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await scope(1, async () => expect((await repo.findById(1))?.stock).toBe(10));
  });
});

for (const driver of ["sqlite", "mysql"] as const) {
  describe.skipIf(driver === "mysql" && !process.env.MYSQL_URL)(
    `${driver} conditional writes`,
    () => {
      let connection: import("@getstrata/core/database/baseRepository").DatabaseConnection;
      let previous: ReturnType<typeof getBoundDatabaseConnection>;
      const repo = new BaseRepository(table);
      beforeAll(async () => {
        if (driver === "mysql") {
          const { createMysqlConnection } = await import(
            "@getstrata/core/database/mysqlConnection"
          );
          connection = createMysqlConnection(process.env.MYSQL_URL ?? "");
        } else {
          const { createSqliteConnection } = await import(
            "@getstrata/core/database/sqliteConnection"
          );
          connection = createSqliteConnection(":memory:");
        }
        previous = getBoundDatabaseConnection();
        bindDatabaseConnection(connection);
        await connection.unsafe(
          `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, stock INTEGER NOT NULL, deleted_at TIMESTAMP NULL)`,
        );
      });
      beforeEach(async () => {
        await connection.unsafe(`DELETE FROM ${name}`);
        await connection.unsafe(
          `INSERT INTO ${name} (id,tenant_id,stock) VALUES (1,1,10),(2,2,20)`,
        );
      });
      afterAll(async () => {
        if (previous) bindDatabaseConnection(previous);
        else resetBoundDatabaseConnection();
        try {
          await connection?.unsafe(`DROP TABLE IF EXISTS ${name}`);
        } finally {
          await connection?.close?.();
        }
      });
      const scope = <T>(work: () => Promise<T>) =>
        runWithSqlDialect(driver, () => runInTransaction(work));
      test("bulk soft deletes retain the row and exclude it from later matches", async () => {
        const soft = new BaseRepository(
          defineTable<
            { id: number; tenant_id: number; stock: number; deleted_at: Date | null },
            "id"
          >({
            name,
            primaryKey: "id",
            columns: ["id", "tenant_id", "stock", "deleted_at"],
            softDeletes: true,
          }),
        );
        await scope(async () => {
          expect(await soft.query().where({ id: 1 }).delete()).toBe(1);
          expect(await soft.query().where({ id: 1 }).delete()).toBe(0);
          expect(await soft.findById(1)).toBeNull();
          expect((await soft.findAll({ withTrashed: true, where: { id: 1 } })).length).toBe(1);
        });
      });
      test("atomic predicates, affected counts and rollback", async () => {
        await scope(async () => {
          expect(await repo.query().where({ id: 1, stock: 10 }).update({ stock: 9 })).toBe(1);
          expect(await repo.query().where({ id: 1, stock: 10 }).update({ stock: 0 })).toBe(0);
          expect(await repo.query().where({ id: 1, stock: 9 }).update({ stock: 9 })).toBe(1);
          if (driver === "sqlite")
            expect(
              await repo.query().where({ id: 1 }).updateReturning({ stock: 8 }, "stock"),
            ).toEqual([{ stock: 8 }]);
          else
            await expect(
              repo.query().where({ id: 1 }).updateReturning({ stock: 8 }, "stock"),
            ).rejects.toThrow("not supported");
          expect(await repo.query().where({ id: 2 }).delete()).toBe(1);
        });
        await expect(
          scope(async () => {
            await repo.query().where({ id: 1 }).update({ stock: 0 });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect((await runWithSqlDialect(driver, () => repo.findById(1)))?.stock).toBe(
          driver === "sqlite" ? 8 : 9,
        );
      });
    },
  );
}
