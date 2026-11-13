import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import type { TransactionSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import type { KeysetCursor } from "@getstrata/core/pagination";
import { SQL } from "bun";
import {
  createNativePersistenceApplication,
  sessionSql,
} from "../helpers/nativePersistenceApplication";

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
      let native: Awaited<ReturnType<typeof createNativePersistenceApplication>>;
      const captured: Array<{ text: string; params: readonly unknown[] }> = [];
      const repositoryDefinition = defineRepository({
        name: "keyset.repository",
        table,
        dependencies: [] as const,
        create: (binding) => new BaseRepository(binding),
      });
      const repoFor = (selected: TransactionSession) => selected.repository(repositoryDefinition);
      beforeAll(async () => {
        if (driver === "pgsql") {
          owner = new SQL(process.env.MIGRATION_DATABASE_URL!);
          native = await createNativePersistenceApplication(
            {
              default: "test",
              connections: { test: { driver: "pgsql", url: urls.pgsql!, max: 5 } },
              repositories: [repositoryDefinition],
            },
            (statement) => captured.push(statement),
          );
          const [role] = await native.run((database) =>
            database.execute<{ rolsuper: boolean; rolbypassrls: boolean }>({
              text: "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
              params: [],
            }),
          );
          expect(role!.rolsuper || role!.rolbypassrls).toBe(false);
          await owner.unsafe(
            `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, stamp TIMESTAMPTZ(6) NOT NULL, label TEXT NOT NULL, score DOUBLE PRECISION NOT NULL); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${name} FORCE ROW LEVEL SECURITY; CREATE POLICY scope ON ${name} USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer); GRANT SELECT ON ${name} TO strata_app`,
          );
        } else {
          owner = createMysqlConnection(urls.mysql!);
          native = await createNativePersistenceApplication(
            {
              default: "test",
              connections: { test: { driver: "mysql", url: urls.mysql! } },
              repositories: [repositoryDefinition],
            },
            (statement) => captured.push(statement),
          );
          await owner.unsafe(
            `CREATE TABLE ${name} (id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL,stamp DATETIME(6) NOT NULL,label TEXT NOT NULL,score DOUBLE NOT NULL)`,
          );
        }
        await owner.unsafe(
          `INSERT INTO ${name} VALUES (10,1,'2030-01-01 00:00:00.123451','a',1.0000000000000002),(2,1,'2030-01-01 00:00:00.123452','b',1.0000000000000004),(8,1,'2030-01-01 00:00:00.123452','c',2),(900,2,'2031-01-01','private',3)`,
        );
      });
      afterAll(async () => {
        await owner?.unsafe(`DROP TABLE IF EXISTS ${name}`);
        await owner?.close();
        await native?.close();
      });
      const scope = <T>(
        id: number,
        work: (repo: ReturnType<typeof repoFor>, transaction: TransactionSession) => Promise<T>,
      ) =>
        driver === "pgsql"
          ? native.tenant(id, (transaction) => work(repoFor(transaction), transaction))
          : native.run((database) =>
              database.transaction((transaction) => work(repoFor(transaction), transaction)),
            );
      test("native Date truncation cannot skip microsecond boundaries and equal timestamps", async () => {
        let cursor: KeysetCursor | undefined;
        const ids: number[] = [];
        do {
          const page = await scope(1, (repo, _transaction) =>
            repo.query().where({ tenant_id: 1 }).keysetPaginate({ perPage: 1, orderBy, cursor }),
          );
          ids.push(...page.data.map((r) => r.id));
          if (page.meta.next_cursor && ids.length === 1)
            expect(page.meta.next_cursor.values[0]).toContain("123452");
          cursor = page.meta.next_cursor ?? undefined;
        } while (cursor);
        expect(ids).toEqual([8, 2, 10]);
        const page = await scope(1, (repo, _transaction) =>
          repo.query().where({ tenant_id: 1 }).projectKeyset(["label"], { perPage: 1, orderBy }),
        );
        expect(page.data).toEqual([{ label: "c" }]);
      });
      test("adjacent doubles and mixed directions retain native comparisons", async () => {
        const order = [
          { column: "score", direction: "asc" },
          { column: "id", direction: "desc" },
        ] as const;
        const first = await scope(1, (repo, _transaction) =>
          repo.query().where({ tenant_id: 1 }).keysetPaginate({ perPage: 1, orderBy: order }),
        );
        const next = await scope(1, (repo, _transaction) =>
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
            scope(1, (repo, _transaction) => repo.query().keysetPaginate({ perPage: 1, orderBy })),
            scope(2, (repo, _transaction) => repo.query().keysetPaginate({ perPage: 1, orderBy })),
          ]);
          expect(a.data[0]?.id).toBe(8);
          expect(b.data[0]?.id).toBe(900);
          const rows = await scope(2, (repo, _transaction) =>
            repo
              .query()
              .orWhere({ tenant_id: 1 })
              .keysetPaginate({ perPage: 10, orderBy, cursor: a.meta.next_cursor! }),
          );
          expect(rows.data).toEqual([]);
        },
      );
      test.skipIf(driver !== "pgsql")(
        "same-direction middle cursors seek the compound index under RLS",
        async () => {
          await owner.unsafe(`INSERT INTO ${name}
          SELECT 20000+g,1,'2035-01-01'::timestamptz+(g/5)*interval '1 microsecond','bulk',0
          FROM generate_series(1,12000) g`);
          await owner.unsafe(
            `CREATE INDEX ${name}_seek ON ${name} (tenant_id,stamp,id); ANALYZE ${name}`,
          );
          await scope(1, async (repo, transaction) => {
            const active = sessionSql(transaction);
            const [boundary] = await active.unsafe<{ stamp: string; id: string }>(
              `SELECT stamp::text AS stamp,id::text AS id FROM ${name} WHERE tenant_id=1 AND id=26000`,
            );
            expect(boundary).toBeDefined();
            for (const direction of ["asc", "desc"] as const) {
              const ordering = orderBy.map((item) => ({ ...item, direction }));
              let query = "";
              let params: readonly unknown[] = [];
              captured.length = 0;
              const page = await repo
                .query()
                .where({ tenant_id: 1 })
                .keysetPaginate({
                  perPage: 20,
                  orderBy: ordering,
                  cursor: { version: 1, order: ordering, values: [boundary!.stamp, boundary!.id] },
                });
              const statement = captured.findLast((statement) =>
                statement.text.startsWith("SELECT"),
              );
              if (!statement) throw Error("Expected the actual native keyset statement.");
              query = statement.text;
              params = statement.params;
              expect(page.data).toHaveLength(20);
              expect(page.data.every((row) => row.tenant_id === 1)).toBe(true);
              const [row] = await active.unsafe<{
                "QUERY PLAN": Array<{ Plan: Record<string, unknown> }>;
              }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, params);
              expect(row).toBeDefined();
              let scanned = 0;
              let filtered = 0;
              let range = false;
              const walk = (node: Record<string, unknown>) => {
                if (
                  String(node["Index Name"] ?? "") === `${name}_seek` &&
                  String(node["Index Cond"] ?? "").includes("ROW")
                )
                  range = true;
                if (String(node["Node Type"]).includes("Scan"))
                  scanned += Number(node["Actual Rows"] ?? 0) * Number(node["Actual Loops"] ?? 1);
                filtered +=
                  Number(node["Rows Removed by Filter"] ?? 0) * Number(node["Actual Loops"] ?? 1);
                for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child);
              };
              walk(row!["QUERY PLAN"][0]!.Plan);
              expect(range).toBe(true);
              expect(scanned).toBeLessThanOrEqual(32);
              expect(filtered).toBeLessThanOrEqual(32);
              expect(page.data.map((row) => row.id)).toEqual(
                direction === "desc"
                  ? Array.from({ length: 20 }, (_, i) => 25999 - i)
                  : Array.from({ length: 20 }, (_, i) => 26001 + i),
              );
            }
          });
        },
      );
    },
  );
}
