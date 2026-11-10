import type { SqlDialect } from "@getstrata/core/database/dialect";
import * as Query from "@getstrata/core/database/query";
import {
  buildHasManyThroughQuery,
  buildPivotLookupQuery,
} from "@getstrata/core/database/relationQueries";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type DialectBuilders = Omit<
  typeof Query,
  | "assertSafeProjectionExpression"
  | "parseQualifiedColumn"
  | "resolveSoftDeleteColumn"
  | "EAGER_ROW_NUMBER"
>;
type RequiredDialectArguments = {
  [K in keyof DialectBuilders]: Equal<Parameters<DialectBuilders[K]>[0], SqlDialect>;
};
type RequireAllTrue<T extends Record<keyof T, true>> = T;
export type CompilerDialectArgumentProof = RequireAllTrue<RequiredDialectArguments>;

/** Compiled only; negatives are never executed. */
export function explicitCompilerContracts(session: DatabaseSession) {
  const table = defineTable<{ id: number; label: string }, "id">({
    name: "widgets",
    primaryKey: "id",
    columns: ["id", "label"],
  });
  const dialect: SqlDialect = session.dialect;
  const selected: { text: string; params: unknown[] } = Query.buildSelectQuery(dialect, table, {
    where: { id: 1 },
  });
  const inserted: { text: string; params: unknown[] } = Query.buildInsertQuery(dialect, table, {
    label: "ready",
  });
  const through = buildHasManyThroughQuery(
    dialect,
    table,
    { throughTable: "owners", firstKey: "group_id", secondLocalKey: "id", secondKey: "id" },
    [1],
    {},
  );
  const pivot: { text: string; params: readonly unknown[] } = buildPivotLookupQuery(
    dialect,
    { pivotTable: "widget_owner", foreignPivotKey: "owner_id" },
    [1],
  );
  const parsed = Query.parseQualifiedColumn("widgets.id");
  const deleted: string | null = Query.resolveSoftDeleteColumn(table);
  const eager: "__strata_eager_row_number" = Query.EAGER_ROW_NUMBER;
  Query.assertSafeProjectionExpression("COUNT(*)");
  // @ts-expect-error Removed ambient SELECT signature has no compatibility overload.
  Query.buildSelectQuery(table, { where: { id: 1 } });
  // @ts-expect-error Removed ambient INSERT signature has no compatibility overload.
  Query.buildInsertQuery(table, { label: "ready" });
  // @ts-expect-error Identifier formatting requires an explicit descriptor first.
  Query.quoteIdentifier("widgets");
  // @ts-expect-error A driver name alone is not a SqlDialect descriptor.
  Query.buildSelectQuery("pgsql", table);
  // @ts-expect-error A descriptor cannot omit its pure SQL operations.
  Query.buildSelectQuery({ driver: "pgsql" }, table);
  // @ts-expect-error Relations also require the explicit dialect first.
  buildPivotLookupQuery({ pivotTable: "widget_owner", foreignPivotKey: "owner_id" }, [1]);
  // @ts-expect-error Pure parsing did not gain a dialect argument.
  Query.parseQualifiedColumn(dialect, "widgets.id");
  return { selected, inserted, through, pivot, parsed, deleted, eager };
}
