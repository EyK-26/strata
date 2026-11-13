import { test } from "bun:test";
import assert from "node:assert/strict";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import {
  buildInsertQuery,
  buildLimitedRelationQuery,
  buildQueryWhereClause,
  buildSelectQuery,
  quoteIdentifier,
} from "@getstrata/core/database/query";
import {
  buildHasManyThroughQuery,
  buildPivotLookupQuery,
} from "@getstrata/core/database/relationQueries";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { defineTable } from "@getstrata/core/database/table";
import type { QueryOptions } from "@getstrata/core/database/types";

type Widget = { id: number; label: string; owner_id: number };
const widgets = defineTable<Widget, "id">({
  name: "widgets",
  primaryKey: "id",
  columns: ["id", "label", "owner_id"],
});

test("C1 explicit SQL compiler dialect overrides hostile ambient selection across interleaved calls", () => {
  const options: QueryOptions<Widget> = {
    select: [
      { kind: "literalText", value: "marker", as: "kind" },
      { kind: "column", table: "widgets", column: "id" },
    ],
    where: { label: { ilike: "a%" } },
    orderBy: { column: "label", direction: "ASC", nulls: "last" },
    limit: 2,
  };
  const postgres = {
    driver: "pgsql" as const,
    ambient: "mysql" as const,
    select:
      'SELECT $1::text AS "kind", "widgets"."id" FROM "widgets" WHERE "widgets"."label" ILIKE $2 ORDER BY "widgets"."label" ASC NULLS LAST LIMIT 2',
    insert:
      'INSERT INTO "widgets" ("label", "owner_id") VALUES ($1, $2) RETURNING "widgets"."id", "widgets"."label", "widgets"."owner_id"',
  };
  const mysql = {
    driver: "mysql" as const,
    ambient: "sqlite" as const,
    select:
      "SELECT CAST(? AS CHAR) AS `kind`, `widgets`.`id` FROM `widgets` WHERE `widgets`.`label` LIKE ? ORDER BY (`widgets`.`label` IS NULL) ASC, `widgets`.`label` ASC LIMIT 2",
    insert: "INSERT INTO `widgets` (`label`, `owner_id`) VALUES (?, ?)",
  };
  const sqlite = {
    driver: "sqlite" as const,
    ambient: "pgsql" as const,
    select:
      'SELECT CAST(? AS TEXT) AS "kind", "widgets"."id" FROM "widgets" WHERE "widgets"."label" LIKE ? ORDER BY "widgets"."label" ASC NULLS LAST LIMIT 2',
    insert:
      'INSERT INTO "widgets" ("label", "owner_id") VALUES (?, ?) RETURNING "widgets"."id", "widgets"."label", "widgets"."owner_id"',
  };
  runWithSqlDialect("mysql", () => {
    for (const expected of [postgres, mysql, sqlite, postgres]) {
      runWithSqlDialect(expected.ambient, () => {
        const dialect = dialectFor(expected.driver);
        assert.deepEqual(
          buildSelectQuery(dialect, widgets, options),
          { text: expected.select, params: ["marker", "a%"] },
          "C1 supplied descriptor must exclusively determine exact SELECT SQL and ordered parameters",
        );
        assert.deepEqual(
          buildInsertQuery(dialect, widgets, { label: "alpha", owner_id: 4 }),
          { text: expected.insert, params: ["alpha", 4] },
          "C1 supplied descriptor must determine INSERT quoting, placeholders and RETURNING",
        );
      });
    }
  });
});

test("C2 explicit SQL compiler threads limited callback, through and pivot dialects with nested parameters", () => {
  const pg = dialectFor("pgsql");
  const options: QueryOptions<Widget> = {
    select: [
      { kind: "literalText", value: "entry", as: "kind" },
      { kind: "column", table: "widgets", column: "id" },
    ],
    where: { owner_id: [7, 8] },
    whereNodes: [
      {
        kind: "and",
        group: [
          { kind: "and", where: { label: { ilike: "%needle%" } } },
          { kind: "or", where: { id: { gt: 10 } } },
        ],
      },
    ],
    orderBy: { column: "id", direction: "ASC" },
    limit: 2,
    offset: 1,
  };
  let sourceCalls = 0;
  runWithSqlDialect("sqlite", () => {
    const limited = buildLimitedRelationQuery(
      pg,
      widgets,
      options,
      { table: "widgets", column: "owner_id" },
      (columns, rank, params) => {
        sourceCalls++;
        return runWithSqlDialect("mysql", () => {
          const where = buildQueryWhereClause(pg, widgets, options, options.whereNodes, params);
          return `SELECT ${columns}, ${rank} FROM ${quoteIdentifier(pg, "widgets")}${where.clause}`;
        });
      },
    );
    assert.equal(sourceCalls, 1);
    assert.deepEqual(
      limited,
      {
        text: 'SELECT * FROM (SELECT $1::text AS "kind", "widgets"."id", ROW_NUMBER() OVER (PARTITION BY "widgets"."owner_id" ORDER BY "widgets"."id" ASC) AS "__strata_eager_row_number" FROM "widgets" WHERE "widgets"."owner_id" IN ($2, $3) AND ("widgets"."label" ILIKE $4 OR "widgets"."id" > $5)) AS "__strata_eager" WHERE "__strata_eager_row_number" > 1 AND "__strata_eager_row_number" <= 3 ORDER BY "__strata_eager_row_number"',
        params: ["entry", 7, 8, "%needle%", 10],
      },
      "C2 outer formatting and nested WHERE must retain the supplied PostgreSQL descriptor through a callback with a conflicting owned dialect",
    );
    assert.deepEqual(
      buildHasManyThroughQuery(
        dialectFor("mysql"),
        widgets,
        {
          throughTable: "owners",
          firstKey: "group_id",
          secondLocalKey: "id",
          secondKey: "owner_id",
        },
        [31, 32],
        {
          where: { label: "ready" },
          whereNodes: [
            {
              kind: "and",
              group: [
                { kind: "and", where: { owner_id: { gt: 0 } } },
                { kind: "or", where: { id: { gt: 9 } } },
              ],
            },
          ],
          orderBy: { column: "id", direction: "ASC" },
          limit: 2,
          offset: 1,
        },
      ),
      {
        text: "SELECT * FROM (SELECT `widgets`.`id`, `widgets`.`label`, `widgets`.`owner_id`, `owners`.`group_id` AS `__through_parent_id`, ROW_NUMBER() OVER (PARTITION BY `owners`.`group_id` ORDER BY `widgets`.`id` ASC) AS `__strata_eager_row_number` FROM `widgets` INNER JOIN `owners` ON `owners`.`id` = `widgets`.`owner_id` WHERE `owners`.`group_id` IN (?, ?) AND (`widgets`.`label` = ? AND (`widgets`.`owner_id` > ? OR `widgets`.`id` > ?))) AS `__strata_eager` WHERE `__strata_eager_row_number` > 1 AND `__strata_eager_row_number` <= 3 ORDER BY `__strata_eager_row_number`",
        params: [31, 32, "ready", 0, 9],
      },
      "C2 limited through callback must forward MySQL dialect and accumulate parent/filter values in order",
    );
    assert.deepEqual(
      buildPivotLookupQuery(
        pg,
        { pivotTable: "group_widget", foreignPivotKey: "group_id" },
        [31, 32],
      ),
      { text: "SELECT * FROM group_widget WHERE group_id IN ($1, $2)", params: [31, 32] },
    );
  });
});
