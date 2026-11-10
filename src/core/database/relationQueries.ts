import {
  buildJoinClause,
  buildLimitedRelationQuery,
  buildQueryWhereClause,
  qualifyColumn,
  quoteIdentifier,
} from "./query.ts";
import type { SqlDialect } from "./sqlDialects.ts";
import type { TableDefinition } from "./table.ts";
import type { QueryOptions } from "./types.ts";

function buildThroughWhere<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity>,
  parentIds: readonly unknown[],
): { text: string; params: unknown[] } {
  const parameters = [...parentIds];
  const { clause } = buildQueryWhereClause(dialect, table, options, options.whereNodes, parameters);
  return {
    text: clause ? ` AND (${clause.replace(/^ WHERE /, "")})` : "",
    params: parameters.slice(parentIds.length),
  };
}

function buildHasManyThroughQuery<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  relation: {
    throughTable: string;
    firstKey: string;
    secondLocalKey: string;
    secondKey: string;
    throughParentKey?: string;
  },
  parentIds: readonly unknown[],
  options: QueryOptions<TEntity>,
): { text: string; params: unknown[] } {
  const throughParentKey = relation.throughParentKey ?? "__through_parent_id";
  const farTable = table.name;
  if (options.limit !== undefined || options.offset !== undefined) {
    return buildLimitedRelationQuery(
      dialect,
      table,
      options,
      { table: relation.throughTable, column: relation.firstKey },
      (columns, rank, params) => {
        const placeholders = parentIds
          .map((id) => {
            params.push(id);
            return dialect.placeholder(params.length);
          })
          .join(", ");
        const { clause } = buildQueryWhereClause(
          dialect,
          table,
          options,
          options.whereNodes,
          params,
        );
        const extra = clause ? ` AND (${clause.replace(/^ WHERE /, "")})` : "";
        return `SELECT ${columns}, ${qualifyColumn(dialect, relation.throughTable, relation.firstKey)} AS ${quoteIdentifier(dialect, throughParentKey)}, ${rank} FROM ${quoteIdentifier(dialect, farTable)} INNER JOIN ${quoteIdentifier(dialect, relation.throughTable)} ON ${qualifyColumn(dialect, relation.throughTable, relation.secondLocalKey)} = ${qualifyColumn(dialect, farTable, relation.secondKey)}${buildJoinClause(dialect, options.joins)} WHERE ${qualifyColumn(dialect, relation.throughTable, relation.firstKey)} IN (${placeholders})${extra}`;
      },
    );
  }
  const columns = table.columns
    .map((column) => `${qualifyColumn(dialect, farTable, column)}`)
    .join(", ");
  const placeholders = parentIds.map((_, index) => dialect.placeholder(index + 1)).join(", ");
  const { text: extraWhere, params: extraParams } = buildThroughWhere(
    dialect,
    table,
    options,
    parentIds,
  );
  const sql = `SELECT ${columns}, ${qualifyColumn(dialect, relation.throughTable, relation.firstKey)} AS ${throughParentKey} FROM ${quoteIdentifier(dialect, farTable)} INNER JOIN ${quoteIdentifier(dialect, relation.throughTable)} ON ${qualifyColumn(dialect, relation.throughTable, relation.secondLocalKey)} = ${qualifyColumn(dialect, farTable, relation.secondKey)}${buildJoinClause(dialect, options.joins)} WHERE ${qualifyColumn(dialect, relation.throughTable, relation.firstKey)} IN (${placeholders})${extraWhere}`;
  return { text: sql, params: [...parentIds, ...extraParams] };
}

function buildPivotLookupQuery(
  dialect: SqlDialect,
  relation: { pivotTable: string; foreignPivotKey: string },
  parentIds: readonly unknown[],
): { text: string; params: readonly unknown[] } {
  const placeholders = parentIds.map((_, index) => dialect.placeholder(index + 1)).join(", ");
  return {
    text: `SELECT * FROM ${relation.pivotTable} WHERE ${String(relation.foreignPivotKey)} IN (${placeholders})`,
    params: parentIds,
  };
}

export { buildHasManyThroughQuery, buildPivotLookupQuery };
