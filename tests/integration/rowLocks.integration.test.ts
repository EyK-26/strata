import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
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
const name = `lock_probe_${crypto.randomUUID().replaceAll("-", "")}`;
const table = defineTable<{ id: number; tenant_id: number; stock: number }, "id">({
  name,
  primaryKey: "id",
  columns: ["id", "tenant_id", "stock"],
});
class Stock extends defineModel(table) {}
Stock.$timestamps = false;
Stock.$fillable = ["stock"];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
describe.skipIf(!url || !adminUrl)("Postgres typed row locks under restricted-role RLS", () => {
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
      `CREATE TABLE ${name} (id INTEGER NOT NULL,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL,PRIMARY KEY (id,tenant_id)); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_scope ON ${name} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer); GRANT SELECT,UPDATE ON ${name} TO strata_app; INSERT INTO ${name} VALUES (1,1,10),(1,2,20)`,
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
  test("competing buyers serialize and observe committed stock; other tenants remain independent", async () => {
    const entered = gate();
    const finish = gate();
    const first = scope(1, async () => {
      const row = await Stock.query().where({ id: 1 }).lockForUpdate().first();
      entered.release();
      await finish.promise;
      await row!.update({ stock: row!.get("stock") - 1 });
    });
    await entered.promise;
    let admitted = false;
    const second = scope(1, async () => {
      const row = await Stock.query().where({ id: 1 }).lockForUpdate().select("stock").first();
      admitted = true;
      expect(row!.stock).toBe(9);
    });
    try {
      await Bun.sleep(30);
      expect(admitted).toBe(false);
      await scope(2, async () => {
        expect(
          (await Stock.query().where({ id: 1 }).lockForUpdate().select("stock").first())!.stock,
        ).toBe(20);
      });
    } finally {
      finish.release();
    }
    await Promise.all([first, second]);
  });
  test("SKIP LOCKED returns no row and savepoint failure does not release the outer lock", async () => {
    const entered = gate();
    const finish = gate();
    const first = scope(1, async () => {
      await Stock.query().lockForUpdate().first();
      await expect(
        runInTransaction(async () => {
          await Stock.query().sharedLock().first();
          throw new Error("savepoint failure");
        }),
      ).rejects.toThrow("savepoint failure");
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    try {
      await scope(1, async () => {
        expect(await Stock.query().lockForUpdate({ wait: "skipLocked" }).first()).toBeNull();
      });
    } finally {
      finish.release();
    }
    await first;
    await scope(1, async () => {
      expect(await Stock.query().lockForUpdate({ wait: "nowait" }).first()).not.toBeNull();
    });
  });
  test("NOWAIT fails while exclusive owner holds the row", async () => {
    const entered = gate();
    const finish = gate();
    const first = scope(1, async () => {
      await Stock.query().lockForUpdate().first();
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    try {
      await expect(
        scope(1, () => Stock.query().sharedLock({ wait: "nowait" }).first()),
      ).rejects.toThrow();
    } finally {
      finish.release();
    }
    await first;
  });
});

describe.skipIf(!process.env.MYSQL_URL)("MySQL 8 typed row locks", () => {
  let connection: Awaited<
    ReturnType<typeof import("@getstrata/core/database/mysqlConnection").createMysqlConnection>
  >;
  let previous: ReturnType<typeof getBoundDatabaseConnection>;
  beforeAll(async () => {
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    connection = createMysqlConnection(process.env.MYSQL_URL!);
    previous = getBoundDatabaseConnection();
    bindDatabaseConnection(connection);
    await connection.unsafe(
      `CREATE TABLE ${name} (id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,stock INTEGER NOT NULL)`,
    );
    await connection.unsafe(`INSERT INTO ${name} VALUES (1,1,10)`);
  });
  afterAll(async () => {
    try {
      await connection?.unsafe(`DROP TABLE IF EXISTS ${name}`);
    } finally {
      if (previous) bindDatabaseConnection(previous);
      else resetBoundDatabaseConnection();
      await connection?.close();
    }
  });
  test("exclusive/shared clauses and SKIP LOCKED/NOWAIT execute on the actual driver", async () => {
    const entered = gate();
    const finish = gate();
    const scope = <T>(work: () => Promise<T>) =>
      runWithSqlDialect("mysql", () => runInTransaction(work));
    const holder = scope(async () => {
      await Stock.query().where({ id: 1 }).lockForUpdate().first();
      entered.release();
      await finish.promise;
    });
    await entered.promise;
    try {
      await scope(async () => {
        expect(
          await Stock.query().where({ id: 1 }).lockForUpdate({ wait: "skipLocked" }).first(),
        ).toBeNull();
      });
      await expect(
        scope(() => Stock.query().where({ id: 1 }).sharedLock({ wait: "nowait" }).first()),
      ).rejects.toThrow();
    } finally {
      finish.release();
    }
    await holder;
    await scope(async () => {
      expect((await Stock.query().sharedLock().select("stock").first())!.stock).toBe(10);
    });
  });
});
