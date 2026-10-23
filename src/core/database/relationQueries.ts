import { currentSqlDialect } from "./dialect.ts";
import {
  buildJoinClause,
  buildLimitedRelationQuery,
  buildQueryWhereClause,
  qualifyColumn,
  quoteIdentifier,
} from "./query.ts";
import type { TableDefinition } from "./table.ts";
import type { QueryOptions } from "./types.ts";

function buildThroughWhere<TEntity extends object>(
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity>,
  parentIds: readonly unknown[],
): { text: string; params: unknown[] } {
  const parameters = [...parentIds];
  const { clause } = buildQueryWhereClause(table, options, options.whereNodes, parameters);
  return {
    text: clause ? ` AND (${clause.replace(/^ WHERE /, "")})` : "",
    params: parameters.slice(parentIds.length),
  };
}

function buildHasManyThroughQuery<TEntity extends object>(
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
      table,
      options,
      { table: relation.throughTable, column: relation.firstKey },
      (columns, rank, params) => {
        const placeholders = parentIds
          .map((id) => {
            params.push(id);
            return currentSqlDialect().placeholder(params.length);
          })
          .join(", ");
        const { clause } = buildQueryWhereClause(table, options, options.whereNodes, params);
        const extra = clause ? ` AND (${clause.replace(/^ WHERE /, "")})` : "";
        return `SELECT ${columns}, ${qualifyColumn(relation.throughTable, relation.firstKey)} AS ${quoteIdentifier(throughParentKey)}, ${rank} FROM ${quoteIdentifier(farTable)} INNER JOIN ${quoteIdentifier(relation.throughTable)} ON ${qualifyColumn(relation.throughTable, relation.secondLocalKey)} = ${qualifyColumn(farTable, relation.secondKey)}${buildJoinClause(options.joins)} WHERE ${qualifyColumn(relation.throughTable, relation.firstKey)} IN (${placeholders})${extra}`;
      },
    );
  }
  const columns = table.columns.map((column) => `${qualifyColumn(farTable, column)}`).join(", ");
  const placeholders = parentIds
    .map((_, index) => currentSqlDialect().placeholder(index + 1))
    .join(", ");
  const { text: extraWhere, params: extraParams } = buildThroughWhere(table, options, parentIds);
  const sql = `SELECT ${columns}, ${qualifyColumn(relation.throughTable, relation.firstKey)} AS ${throughParentKey} FROM ${quoteIdentifier(farTable)} INNER JOIN ${quoteIdentifier(relation.throughTable)} ON ${qualifyColumn(relation.throughTable, relation.secondLocalKey)} = ${qualifyColumn(farTable, relation.secondKey)}${buildJoinClause(options.joins)} WHERE ${qualifyColumn(relation.throughTable, relation.firstKey)} IN (${placeholders})${extraWhere}`;
  return { text: sql, params: [...parentIds, ...extraParams] };
}

function buildPivotLookupQuery(
  relation: { pivotTable: string; foreignPivotKey: string },
  parentIds: readonly unknown[],
): { text: string; params: readonly unknown[] } {
  const placeholders = parentIds
    .map((_, index) => currentSqlDialect().placeholder(index + 1))
    .join(", ");
  return {
    text: `SELECT * FROM ${relation.pivotTable} WHERE ${String(relation.foreignPivotKey)} IN (${placeholders})`,
    params: parentIds,
  };
}

export { buildHasManyThroughQuery, buildPivotLookupQuery };
