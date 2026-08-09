import type { TableDefinition } from "./table.ts";
import type {
  MutationValues,
  QueryFilterValue,
  QueryJoin,
  QueryOperator,
  QueryOptions,
  QueryOrder,
  QuerySelectItem,
  QueryWhere,
  UpdateValues,
} from "./types.ts";
import type { WhereNode } from "./whereBuilder.ts";

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function qualifyColumn(tableName: string, column: string): string {
  return `${quoteIdentifier(tableName)}.${quoteIdentifier(column)}`;
}

function resolveQualifiedColumn(defaultTable: string, columnName: string): string {
  if (columnName.includes(".")) {
    const [table, column] = columnName.split(".", 2);

    if (!table || !column) {
      throw new Error(`Invalid qualified column: ${columnName}`);
    }

    return qualifyColumn(table, column);
  }

  return qualifyColumn(defaultTable, columnName);
}

function parseQualifiedColumn(reference: string): { table: string; column: string } {
  const [table, column] = reference.split(".", 2);

  if (!table || !column) {
    throw new Error(`Join columns must be qualified as table.column: ${reference}`);
  }

  return { table, column };
}

function normalizeDirection(direction: "ASC" | "DESC" | "asc" | "desc" = "ASC"): "ASC" | "DESC" {
  return direction.toUpperCase() === "DESC" ? "DESC" : "ASC";
}

function isQueryOperator(value: QueryFilterValue): value is QueryOperator {
  return (
    value !== null && !Array.isArray(value) && !(value instanceof Date) && typeof value === "object"
  );
}

function pushParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function buildInClause(column: string, values: readonly unknown[], params: unknown[]): string {
  if (values.length === 0) {
    return "1 = 0";
  }

  const placeholders = values.map((value) => pushParam(params, value)).join(", ");
  return `${column} IN (${placeholders})`;
}

function buildOperatorClauses(
  column: string,
  operator: QueryOperator,
  params: unknown[],
): string[] {
  const clauses: string[] = [];

  if (operator.isNull === true) {
    clauses.push(`${column} IS NULL`);
  }

  if (operator.isNull === false) {
    clauses.push(`${column} IS NOT NULL`);
  }

  if (operator.eq !== undefined) {
    if (operator.eq === null) {
      clauses.push(`${column} IS NULL`);
    } else {
      clauses.push(`${column} = ${pushParam(params, operator.eq)}`);
    }
  }

  if (operator.in !== undefined) {
    clauses.push(buildInClause(column, operator.in, params));
  }

  if (operator.gt !== undefined) {
    clauses.push(`${column} > ${pushParam(params, operator.gt)}`);
  }

  if (operator.gte !== undefined) {
    clauses.push(`${column} >= ${pushParam(params, operator.gte)}`);
  }

  if (operator.lt !== undefined) {
    clauses.push(`${column} < ${pushParam(params, operator.lt)}`);
  }

  if (operator.lte !== undefined) {
    clauses.push(`${column} <= ${pushParam(params, operator.lte)}`);
  }

  if (operator.ilike !== undefined) {
    clauses.push(`${column} ILIKE ${pushParam(params, `%${operator.ilike}%`)}`);
  }

  if (operator.tsMatch !== undefined) {
    clauses.push(`${column} @@ plainto_tsquery('english', ${pushParam(params, operator.tsMatch)})`);
  }

  return clauses;
}

function appendWhereParts<TEntity extends object>(
  tableName: string,
  where: QueryWhere<TEntity>,
  params: unknown[],
): string {
  const clauses: string[] = [];

  for (const [columnName, filterValue] of Object.entries(where) as Array<
    [keyof TEntity & string, QueryFilterValue | undefined]
  >) {
    if (filterValue === undefined) {
      continue;
    }

    const column = resolveQualifiedColumn(tableName, columnName);

    if (Array.isArray(filterValue)) {
      clauses.push(buildInClause(column, filterValue, params));
      continue;
    }

    if (isQueryOperator(filterValue)) {
      clauses.push(...buildOperatorClauses(column, filterValue, params));
      continue;
    }

    if (filterValue === null) {
      clauses.push(`${column} IS NULL`);
      continue;
    }

    clauses.push(`${column} = ${pushParam(params, filterValue)}`);
  }

  return clauses.join(" AND ");
}

function buildWhereClause<TEntity extends object>(
  tableName: string,
  where: QueryWhere<TEntity> = {},
): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const body = appendWhereParts(tableName, where, params);

  return {
    clause: body.length > 0 ? ` WHERE ${body}` : "",
    params,
  };
}

function buildWhereNodeClause<TEntity extends object>(
  tableName: string,
  node: WhereNode<TEntity>,
  params: unknown[],
): string {
  if ("where" in node) {
    return appendWhereParts(tableName, node.where, params);
  }

  const grouped = buildWhereGroupClause(tableName, node.group, params);

  if (!grouped) {
    return "";
  }

  return grouped.includes(" OR ") ? `(${grouped})` : grouped;
}

function buildWhereGroupClause<TEntity extends object>(
  tableName: string,
  nodes: readonly WhereNode<TEntity>[],
  params: unknown[],
): string {
  let result = "";

  for (const node of nodes) {
    const part = buildWhereNodeClause(tableName, node, params);

    if (!part) {
      continue;
    }

    if (!result) {
      result = part;
      continue;
    }

    result = node.kind === "or" ? `${result} OR ${part}` : `${result} AND ${part}`;
  }

  if (!result) {
    return "";
  }

  return result;
}

function buildAdvancedWhereClause<TEntity extends object>(
  tableName: string,
  where: QueryWhere<TEntity> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
  params: unknown[] = [],
): { clause: string; params: unknown[] } {
  const nodes: WhereNode<TEntity>[] = [];

  if (Object.keys(where).length > 0) {
    nodes.push({ kind: "and", where });
  }

  nodes.push(...whereNodes);

  const combined = buildWhereGroupClause(tableName, nodes, params);

  return {
    clause: combined ? ` WHERE ${combined}` : "",
    params,
  };
}

function resolveSoftDeleteColumn<TEntity>(table: TableDefinition<TEntity>): string | null {
  if (!table.softDeletes) {
    return null;
  }

  if (table.softDeletes === true) {
    return "deleted_at";
  }

  return table.softDeletes.column ?? "deleted_at";
}

function appendSoftDeleteScope<TEntity>(
  table: TableDefinition<TEntity>,
  options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed">,
  clauses: string[],
): void {
  const column = resolveSoftDeleteColumn(table);

  if (!column) {
    return;
  }

  const qualifiedColumn = qualifyColumn(table.name, column);

  if (options.onlyTrashed) {
    clauses.push(`${qualifiedColumn} IS NOT NULL`);
    return;
  }

  if (!options.withTrashed) {
    clauses.push(`${qualifiedColumn} IS NULL`);
  }
}

function buildQueryWhereClause<TEntity extends object>(
  table: TableDefinition<TEntity>,
  options: Pick<QueryOptions<TEntity>, "where" | "withTrashed" | "onlyTrashed"> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
  params: unknown[] = [],
): { clause: string; params: unknown[] } {
  const { clause, params: whereParams } = buildAdvancedWhereClause(
    table.name,
    options.where ?? {},
    whereNodes,
    params,
  );
  const softDeleteClauses: string[] = [];

  appendSoftDeleteScope(table, options, softDeleteClauses);

  if (softDeleteClauses.length === 0) {
    return { clause, params: whereParams };
  }

  const base = clause.replace(/^ WHERE /, "");
  const scope = softDeleteClauses.join(" AND ");

  return {
    clause: base ? ` WHERE (${base}) AND ${scope}` : ` WHERE ${scope}`,
    params: whereParams,
  };
}

function isQueryOrder<TEntity>(value: object): value is QueryOrder<TEntity> {
  return "column" in value;
}

function normalizeOrderBy<TEntity>(
  orderBy?: QueryOptions<TEntity>["orderBy"],
): QueryOrder<TEntity>[] {
  if (!orderBy) {
    return [];
  }

  if (Array.isArray(orderBy)) {
    return orderBy;
  }

  if (isQueryOrder<TEntity>(orderBy)) {
    return [orderBy];
  }

  return (
    Object.entries(orderBy) as Array<[keyof TEntity & string, QueryOrder<TEntity>["direction"]]>
  ).map(([column, direction]) => ({
    column,
    direction,
  }));
}

function buildOrderByClause<TEntity extends object>(
  tableName: string,
  orderBy?: QueryOptions<TEntity>["orderBy"],
): string {
  const parts = normalizeOrderBy(orderBy).map(({ column, direction }) => {
    return `${resolveQualifiedColumn(tableName, column)} ${normalizeDirection(direction)}`;
  });

  return parts.length > 0 ? ` ORDER BY ${parts.join(", ")}` : "";
}

function buildGroupByClause<TEntity extends object>(
  tableName: string,
  groupBy?: QueryOptions<TEntity>["groupBy"],
): string {
  if (!groupBy) {
    return "";
  }

  const columns = (Array.isArray(groupBy) ? groupBy : [groupBy]).map((column) => String(column));
  const parts = columns.map((column) => resolveQualifiedColumn(tableName, column));
  return parts.length > 0 ? ` GROUP BY ${parts.join(", ")}` : "";
}

function buildHavingClause<TEntity extends object>(
  tableName: string,
  having: QueryOptions<TEntity>["having"],
  params: unknown[],
): string {
  if (!having) {
    return "";
  }

  const body = appendWhereParts(tableName, having, params);
  return body.length > 0 ? ` HAVING ${body}` : "";
}

function buildJoinClause(joins: readonly QueryJoin[] = []): string {
  return joins
    .map((join) => {
      const joinType = join.type === "left" ? "LEFT JOIN" : "INNER JOIN";
      const onClause = join.on
        .map(
          ({ left, right }) =>
            `${qualifyColumn(left.table, left.column)} = ${qualifyColumn(right.table, right.column)}`,
        )
        .join(" AND ");

      return ` ${joinType} ${quoteIdentifier(join.table)} ON ${onClause}`;
    })
    .join("");
}

function buildLimitClause(limit?: number): string {
  if (limit === undefined) {
    return "";
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Query limit must be a positive integer.");
  }

  return ` LIMIT ${limit}`;
}

function buildOffsetClause(offset?: number): string {
  if (offset === undefined) {
    return "";
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Query offset must be a non-negative integer.");
  }

  return ` OFFSET ${offset}`;
}

function buildReturningColumns<TEntity extends object>(table: TableDefinition<TEntity>): string {
  return table.columns.map((column) => qualifyColumn(table.name, column)).join(", ");
}

function buildSelectList<TEntity extends object>(
  table: TableDefinition<TEntity>,
  select?: QuerySelectItem[],
  params: unknown[] = [],
): string {
  if (!select || select.length === 0) {
    return buildReturningColumns(table);
  }

  return select
    .map((item) => {
      if (item.kind === "column") {
        const column = qualifyColumn(item.table, item.column);
        return item.as ? `${column} AS ${quoteIdentifier(item.as)}` : column;
      }

      if (item.kind === "literalText") {
        return `${pushParam(params, item.value)}::text AS ${quoteIdentifier(item.as)}`;
      }

      const column = qualifyColumn(item.table, item.column);
      const placeholder = pushParam(params, item.query);
      return `ts_rank(${column}, plainto_tsquery('english', ${placeholder})) AS ${quoteIdentifier(item.as)}`;
    })
    .join(", ");
}

function getDefinedColumnEntries<TEntity, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  values: Partial<TEntity>,
  options: { exclude?: readonly (keyof TEntity & string)[] } = {},
): Array<[keyof TEntity & string, unknown]> {
  const record = values as Partial<Record<keyof TEntity & string, unknown>>;
  const excluded = new Set<keyof TEntity & string>(options.exclude ?? []);

  return table.columns.flatMap((column) => {
    if (excluded.has(column) || !Object.hasOwn(record, column)) {
      return [];
    }

    const value = record[column];

    if (value === undefined) {
      return [];
    }

    return [[column, value] satisfies [keyof TEntity & string, unknown]];
  });
}

function buildSelectQuery<TEntity extends object>(
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const columns = buildSelectList(table, options.select, params);
  const { clause } = buildQueryWhereClause(table, options, whereNodes, params);
  const joins = buildJoinClause(options.joins);
  const groupBy = buildGroupByClause(table.name, options.groupBy);
  const havingClause = buildHavingClause(table.name, options.having, params);
  const orderBy = buildOrderByClause(table.name, options.orderBy ?? table.defaultOrderBy);
  const limit = buildLimitClause(options.limit);
  const offset = buildOffsetClause(options.offset);

  return {
    text: `SELECT ${columns} FROM ${quoteIdentifier(table.name)}${joins}${clause}${groupBy}${havingClause}${orderBy}${limit}${offset}`,
    params,
  };
}

function buildCountQuery<TEntity extends object>(
  table: TableDefinition<TEntity>,
  where: QueryWhere<TEntity> = {},
  options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed" | "joins" | "groupBy"> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const { clause, params: whereParams } = buildQueryWhereClause(
    table,
    {
      where,
      withTrashed: options.withTrashed,
      onlyTrashed: options.onlyTrashed,
    },
    whereNodes,
  );
  params.push(...whereParams);
  const joins = buildJoinClause(options.joins);
  const groupBy = buildGroupByClause(table.name, options.groupBy);

  return {
    text: `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}${joins}${clause}${groupBy}`,
    params,
  };
}

function buildProjectionQuery<TEntity extends object>(
  table: TableDefinition<TEntity>,
  expression: string,
  alias: string,
  options: QueryOptions<TEntity> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
): { text: string; params: unknown[] } {
  assertSafeProjectionExpression(expression);
  const params: unknown[] = [];
  const { clause, params: whereParams } = buildQueryWhereClause(table, options, whereNodes);
  params.push(...whereParams);
  const joins = buildJoinClause(options.joins);
  const groupBy = buildGroupByClause(table.name, options.groupBy);
  const orderBy = buildOrderByClause(table.name, options.orderBy);
  const limit = buildLimitClause(options.limit);

  return {
    text: `SELECT ${expression} AS ${quoteIdentifier(alias)} FROM ${quoteIdentifier(table.name)}${joins}${clause}${groupBy}${orderBy}${limit}`,
    params,
  };
}

const SAFE_PROJECTION_EXPRESSION =
  /^(COUNT\(\*\)|(?:"[\w_]+"(?:\."[\w_]+")?)|(?:AVG|SUM|MIN|MAX)\((?:"[\w_]+"(?:\."[\w_]+")?)\))$/;

function assertSafeProjectionExpression(expression: string): void {
  if (!SAFE_PROJECTION_EXPRESSION.test(expression.trim())) {
    throw new Error(`Unsafe projection expression: ${expression}`);
  }
}

function buildGroupedCountQuery<TEntity extends object, K extends keyof TEntity & string>(
  table: TableDefinition<TEntity>,
  column: K,
  where: QueryWhere<TEntity> = {},
  options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed"> = {},
): { text: string; params: unknown[] } {
  const qualifiedColumn = qualifyColumn(table.name, column);
  const { clause, params } = buildQueryWhereClause(table, {
    where,
    ...options,
  });

  return {
    text: `SELECT ${qualifiedColumn} AS ${quoteIdentifier("value")}, COUNT(*) AS ${quoteIdentifier("count")} FROM ${quoteIdentifier(table.name)}${clause} GROUP BY ${qualifiedColumn} ORDER BY ${qualifiedColumn} ASC`,
    params,
  };
}

function buildInsertQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  values: MutationValues<TEntity>,
): { text: string; params: unknown[] } {
  const entries = getDefinedColumnEntries(table, values);

  if (entries.length === 0) {
    throw new Error(`Cannot insert into ${table.name} without any column values.`);
  }

  const params: unknown[] = [];
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries.map(([, value]) => pushParam(params, value)).join(", ");
  const returningColumns = buildReturningColumns(table);

  return {
    text: `INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders}) RETURNING ${returningColumns}`,
    params,
  };
}

function buildUpdateQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
  changes: UpdateValues<TEntity, PrimaryKey>,
): { text: string; params: unknown[] } {
  const entries = getDefinedColumnEntries(table, changes as Partial<TEntity>, {
    exclude: [table.primaryKey],
  });

  if (entries.length === 0) {
    throw new Error(`Cannot update ${table.name} without any changed column values.`);
  }

  const params: unknown[] = [];
  const setClause = entries
    .map(([column, value]) => `${quoteIdentifier(column)} = ${pushParam(params, value)}`)
    .join(", ");
  const primaryKeyPlaceholder = pushParam(params, id);
  const returningColumns = buildReturningColumns(table);
  const scopeClauses: string[] = [];

  appendSoftDeleteScope(table, {}, scopeClauses);

  const scopeSuffix = scopeClauses.length > 0 ? ` AND ${scopeClauses.join(" AND ")}` : "";

  return {
    text: `UPDATE ${quoteIdentifier(table.name)} SET ${setClause} WHERE ${quoteIdentifier(table.primaryKey)} = ${primaryKeyPlaceholder}${scopeSuffix} RETURNING ${returningColumns}`,
    params,
  };
}

function buildSoftDeleteByIdQuery<
  TEntity extends object,
  PrimaryKey extends keyof TEntity & string,
>(
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
  deletedAt: Date,
): { text: string; params: unknown[] } {
  const deletedAtColumn = resolveSoftDeleteColumn(table);

  if (!deletedAtColumn) {
    throw new Error(`Table ${table.name} does not support soft deletes.`);
  }

  const returningColumns = buildReturningColumns(table);
  const scopeClauses: string[] = [];
  appendSoftDeleteScope(table, {}, scopeClauses);
  const scopeSuffix = scopeClauses.length > 0 ? ` AND ${scopeClauses.join(" AND ")}` : "";

  return {
    text: `UPDATE ${quoteIdentifier(table.name)} SET ${quoteIdentifier(deletedAtColumn)} = $1 WHERE ${quoteIdentifier(table.primaryKey)} = $2${scopeSuffix} RETURNING ${returningColumns}`,
    params: [deletedAt, id],
  };
}

function buildRestoreByIdQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
): { text: string; params: unknown[] } {
  const deletedAtColumn = resolveSoftDeleteColumn(table);

  if (!deletedAtColumn) {
    throw new Error(`Table ${table.name} does not support soft deletes.`);
  }

  const returningColumns = buildReturningColumns(table);

  return {
    text: `UPDATE ${quoteIdentifier(table.name)} SET ${quoteIdentifier(deletedAtColumn)} = $1 WHERE ${quoteIdentifier(table.primaryKey)} = $2 AND ${qualifyColumn(table.name, deletedAtColumn)} IS NOT NULL RETURNING ${returningColumns}`,
    params: [null, id],
  };
}

function buildDeleteByIdQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
): { text: string; params: unknown[] } {
  return {
    text: `DELETE FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(table.primaryKey)} = $1 RETURNING ${quoteIdentifier(table.primaryKey)} AS ${quoteIdentifier("deleted_id")}`,
    params: [id],
  };
}

export {
  assertSafeProjectionExpression,
  buildAdvancedWhereClause,
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildInsertQuery,
  buildJoinClause,
  buildOrderByClause,
  buildProjectionQuery,
  buildQueryWhereClause,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  buildWhereClause,
  parseQualifiedColumn,
  qualifyColumn,
  quoteIdentifier,
  resolveQualifiedColumn,
  resolveSoftDeleteColumn,
};
