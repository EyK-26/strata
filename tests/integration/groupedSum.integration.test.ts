import { expect, test } from "bun:test";
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
import {
  resetSqlDialect,
  runWithSqlDialect,
  useSqlDialect,
} from "@getstrata/core/database/dialect";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { repositoryConnection } from "@getstrata/core/database/repositoryConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";
import { restoreEnvVar } from "../helpers/restoreEnv";

type Line = {
  id: number;
  tenant_id: number;
  product_id: number;
  quantity: number | null;
  deleted_at: string | null;
};
const columns = ["id", "tenant_id", "product_id", "quantity", "deleted_at"] as const;
const adminUrl = process.env.MIGRATION_DATABASE_URL;
const restrictedUrl = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;

test.skipIf(!adminUrl || !restrictedUrl)(
  "Postgres grouped sums retain restricted tenant scope, active transaction and rollback",
  async () => {
    if (!adminUrl || !restrictedUrl) throw new Error("Dedicated RLS fixtures required.");
    const name = `grouped_sum_${crypto.randomUUID().replaceAll("-", "")}`;
    const control = new SQL(adminUrl);
    let created = false;
    let admin: SQL | undefined, pool: SQL | undefined;
    const previousPool = getDefaultDatabasePool(),
      previousBound = getBoundDatabaseConnection(),
      previousTenancy = process.env.TENANCY_DRIVER;
    try {
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const a = new URL(adminUrl),
        r = new URL(restrictedUrl);
      a.pathname = r.pathname = `/${name}`;
      admin = new SQL(a.href);
      pool = new SQL(r.href);
      const [role] = await pool.unsafe<
        { role: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >(
        "SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      if (!role || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.role))
        throw new Error("Invalid restricted role.");
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      await admin.unsafe(`CREATE TABLE lines(id BIGINT PRIMARY KEY,tenant_id INTEGER NOT NULL,product_id INTEGER,quantity BIGINT,deleted_at TIMESTAMP);
   ALTER TABLE lines ENABLE ROW LEVEL SECURITY; ALTER TABLE lines FORCE ROW LEVEL SECURITY;
   CREATE POLICY scope ON lines USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer);
   GRANT SELECT,INSERT,UPDATE,DELETE ON lines TO "${role.role}"`);
      await admin.unsafe(
        "INSERT INTO lines VALUES(1,101,11,3,NULL),(2,101,11,4,NULL),(3,102,11,100,NULL),(4,101,11,100,NOW()),(5,101,12,NULL,NULL),(7,101,13,9007199254740992,NULL),(8,101,13,1,NULL)",
      );
      registerDefaultDatabasePool(pool as unknown as SqlDatabaseConnection);
      resetBoundDatabaseConnection();
      useSqlDialect("pgsql");
      process.env.TENANCY_DRIVER = "rls";
      const repo = new BaseRepository(
        defineTable<Line, "id">({ name: "lines", primaryKey: "id", columns, softDeletes: true }),
      );
      const tenant = { id: 101, slug: "aggregate", plan: "free", region: "eu" };
      const read = () => repo.query().sumBy("product_id", "quantity");
      expect(await runWithTenantDatabase(tenant, read)).toEqual([
        { value: 11, sum: "7" },
        { value: 12, sum: null },
        { value: 13, sum: "9007199254740993" },
      ]);
      expect(await runWithTenantDatabase({ ...tenant, id: 102 }, read)).toEqual([
        { value: 11, sum: "100" },
      ]);
      await expect(
        runWithTenantDatabase(tenant, async () => {
          await repositoryConnection.unsafe(
            "INSERT INTO lines VALUES($1,$2,$3,$4,NULL)",
            [6, 101, 11, 2],
          );
          expect(
            await repo.query().where({ product_id: 11 }).sumBy("product_id", "quantity"),
          ).toEqual([{ value: 11, sum: "9" }]);
          throw new Error("business rollback");
        }),
      ).rejects.toThrow("business rollback");
      expect(
        await runWithTenantDatabase(tenant, () =>
          repo.query().where({ product_id: 11 }).sumBy("product_id", "quantity"),
        ),
      ).toEqual([{ value: 11, sum: "7" }]);
    } finally {
      registerDefaultDatabasePool(previousPool);
      if (previousBound) bindDatabaseConnection(previousBound);
      else resetBoundDatabaseConnection();
      resetSqlDialect();
      restoreEnvVar("TENANCY_DRIVER", previousTenancy);
      await pool?.close();
      await admin?.close();
      if (created) await control.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await control.close();
    }
  },
);

test.skipIf(!process.env.MYSQL_URL)(
  "MySQL grouped decimal totals preserve exact text and protected predicates",
  async () => {
    const mysqlUrl = process.env.MYSQL_URL;
    if (!mysqlUrl) throw new Error("Dedicated MySQL fixture required.");
    const db = await createMysqlConnection(mysqlUrl);
    const name = `grouped_sum_${crypto.randomUUID().replaceAll("-", "")}`;
    let created = false;
    try {
      await runWithSqlDialect("mysql", async () => {
        await db.unsafe(
          `CREATE TABLE ${name}(id INTEGER PRIMARY KEY,tenant_id INTEGER,product_id INTEGER,quantity DECIMAL(30,0),deleted_at TIMESTAMP NULL)`,
        );
        created = true;
        await db.unsafe(
          `INSERT INTO ${name} VALUES(1,101,11,3,NULL),(2,101,11,4,NULL),(3,102,11,100,NULL),(4,101,12,NULL,NULL),(5,101,13,9007199254740992,NULL),(6,101,13,1,NULL)`,
        );
        const repo = new BaseRepository(
          defineTable<Line, "id">({ name, primaryKey: "id", columns }),
          db,
        );
        expect(
          await repo.query().where({ tenant_id: 101 }).sumBy("product_id", "quantity"),
        ).toEqual([
          { value: 11, sum: "7" },
          { value: 12, sum: null },
          { value: 13, sum: "9007199254740993" },
        ]);
        expect(
          await repo
            .query()
            .where({ tenant_id: 101 })
            .protectWhere()
            .where({ product_id: 11 })
            .orWhere({ tenant_id: 102 })
            .sumBy("product_id", "quantity"),
        ).toEqual([{ value: 11, sum: "7" }]);
        expect(
          await repo.query().where({ tenant_id: 999 }).sumBy("product_id", "quantity"),
        ).toEqual([]);
      });
    } finally {
      if (created) await db.unsafe(`DROP TABLE ${name}`);
      await db.close();
    }
  },
);
