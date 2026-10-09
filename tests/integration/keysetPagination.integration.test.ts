import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { defineTable } from "@getstrata/core/database/table";
import type { KeysetCursor } from "@getstrata/core/pagination";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { SQL } from "bun";

const orderBy = [
  { column: "stamp", direction: "desc" },
  { column: "id", direction: "desc" },
] as const;
const urls = {
  pgsql: process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL,
  mysql: process.env.MYSQL_URL,
};
for (const driver of ["pgsql", "mysql"] as const) {
  describe.skipIf(!urls[driver] || (driver === "pgsql" && !process.env.MIGRATION_DATABASE_URL))(
    `${driver} precise keyset pagination`,
    () => {
      const name = `keyset_${crypto.randomUUID().replaceAll("-", "")}`;
      const table = defineTable<
        { id: number; tenant_id: number; stamp: Date; label: string; score: number },
        "id"
      >({ name, primaryKey: "id", columns: ["id", "tenant_id", "stamp", "label", "score"] });
      let owner: SQL | ReturnType<typeof createMysqlConnection>;
      let runtime: SQL | ReturnType<typeof createMysqlConnection>;
      let previous: SqlDatabaseConnection;
      let bound: ReturnType<typeof getBoundDatabaseConnection>;
      let tenancy: string | undefined;
      const repo = new BaseRepository(table);
      beforeAll(async () => {
        previous = getDefaultDatabasePool();
        bound = getBoundDatabaseConnection();
        tenancy = process.env.TENANCY_DRIVER;
        if (driver === "pgsql") {
          owner = new SQL(process.env.MIGRATION_DATABASE_URL!);
          const pool = new SQL({ url: urls.pgsql!, max: 5 });
          runtime = pool;
          const [role] = await pool.unsafe<{ rolsuper: boolean; rolbypassrls: boolean }[]>(
            "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          );
          expect(role!.rolsuper || role!.rolbypassrls).toBe(false);
          await owner.unsafe(
            `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, stamp TIMESTAMPTZ(6) NOT NULL, label TEXT NOT NULL, score DOUBLE PRECISION NOT NULL); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY; CREATE POLICY scope ON ${name} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer); GRANT SELECT ON ${name} TO strata_app`,
          );
          process.env.TENANCY_DRIVER = "rls";
          registerDefaultDatabasePool(runtime as unknown as SqlDatabaseConnection);
          resetBoundDatabaseConnection();
        } else {
          owner = createMysqlConnection(urls.mysql!);
          runtime = owner;
          await owner.unsafe(
            `CREATE TABLE ${name} (id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,stamp DATETIME(6) NOT NULL,label TEXT NOT NULL,score DOUBLE NOT NULL)`,
          );
          bindDatabaseConnection(runtime);
          process.env.TENANCY_DRIVER = "none";
        }
        await owner.unsafe(
          `INSERT INTO ${name} VALUES (10,1,'2030-01-01 00:00:00.123451','a',1.0000000000000002),(2,1,'2030-01-01 00:00:00.123452','b',1.0000000000000004),(8,1,'2030-01-01 00:00:00.123452','c',2),(900,2,'2031-01-01','private',3)`,
        );
      });
      afterAll(async () => {
        if (previous) registerDefaultDatabasePool(previous);
        if (bound) bindDatabaseConnection(bound);
        else resetBoundDatabaseConnection();
        if (tenancy === undefined) delete process.env.TENANCY_DRIVER;
        else process.env.TENANCY_DRIVER = tenancy;
        await owner?.unsafe(`DROP TABLE IF EXISTS ${name}`);
        await owner?.close();
        if (runtime !== owner) await runtime?.close();
      });
      const scope = <T>(id: number, work: () => Promise<T>) =>
        runWithSqlDialect(driver, () =>
          driver === "pgsql" ? runWithTenantDatabase({ id, slug: `keyset-${id}` }, work) : work(),
        );
      test("native Date truncation cannot skip microsecond boundaries and equal timestamps", async () => {
        let cursor: KeysetCursor | undefined;
        const ids: number[] = [];
        do {
          const page = await scope(1, () =>
            repo.query().where({ tenant_id: 1 }).keysetPaginate({ perPage: 1, orderBy, cursor }),
          );
          ids.push(...page.data.map((r) => r.id));
          if (page.meta.next_cursor && ids.length === 1)
            expect(page.meta.next_cursor.values[0]).toContain("123452");
          cursor = page.meta.next_cursor ?? undefined;
        } while (cursor);
        expect(ids).toEqual([8, 2, 10]);
        const page = await scope(1, () =>
          repo.query().where({ tenant_id: 1 }).projectKeyset(["label"], { perPage: 1, orderBy }),
        );
        expect(page.data).toEqual([{ label: "c" }]);
      });
      test("adjacent doubles and mixed directions retain native comparisons", async () => {
        const order = [
          { column: "score", direction: "asc" },
          { column: "id", direction: "desc" },
        ] as const;
        const first = await scope(1, () =>
          repo.query().where({ tenant_id: 1 }).keysetPaginate({ perPage: 1, orderBy: order }),
        );
        const next = await scope(1, () =>
          repo
            .query()
            .where({ tenant_id: 1 })
            .keysetPaginate({ perPage: 1, orderBy: order, cursor: first.meta.next_cursor! }),
        );
        expect(first.data[0]?.id).toBe(10);
        expect(next.data[0]?.id).toBe(2);
      });
      test.skipIf(driver !== "pgsql")(
        "concurrent tenant scopes and replayed foreign cursor cannot bypass RLS",
        async () => {
          const [a, b] = await Promise.all([
            scope(1, () => repo.query().keysetPaginate({ perPage: 1, orderBy })),
            scope(2, () => repo.query().keysetPaginate({ perPage: 1, orderBy })),
          ]);
          expect(a.data[0]?.id).toBe(8);
          expect(b.data[0]?.id).toBe(900);
          const rows = await scope(2, () =>
            repo
              .query()
              .orWhere({ tenant_id: 1 })
              .keysetPaginate({ perPage: 10, orderBy, cursor: a.meta.next_cursor! }),
          );
          expect(rows.data).toEqual([]);
        },
      );
    },
  );
}
