import type { TableDefinition } from "./table.ts";
import type {
  MutationValues,
  QueryFilterValue,
  QueryOperator,
  QueryOptions,
  QueryOrder,
  QueryWhere,
  UpdateValues,
} from "./types.ts";

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function qualifyColumn(tableName: string, column: string): string {
  return `${quoteIdentifier(tableName)}.${quoteIdentifier(column)}`;
}

function normalizeDirection(
  direction: "ASC" | "DESC" | "asc" | "desc" = "ASC",
): "ASC" | "DESC" {
  return direction.toUpperCase() === "DESC" ? "DESC" : "ASC";
}

function isQueryOperator(value: QueryFilterValue): value is QueryOperator {
  return (
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    typeof value === "object"
  );
}

function pushParam(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function buildInClause(
  column: string,
  values: readonly unknown[],
  params: unknown[],
): string {
  if (values.length === 0) {
    return "1 = 0";
  }

  const placeholders = values
    .map((value) => pushParam(params, value))
    .join(", ");
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

  return clauses;
}

function buildWhereClause<TEntity>(
  tableName: string,
  where: QueryWhere<TEntity> = {},
): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [columnName, filterValue] of Object.entries(where) as Array<
    [keyof TEntity & string, QueryFilterValue | undefined]
  >) {
    if (filterValue === undefined) {
      continue;
    }

    const column = qualifyColumn(tableName, columnName);

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

  return {
    clause: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function normalizeOrderBy<TEntity>(
  orderBy?: QueryOrder<TEntity> | QueryOrder<TEntity>[],
): QueryOrder<TEntity>[] {
  if (!orderBy) {
    return [];
  }

  return Array.isArray(orderBy) ? orderBy : [orderBy];
}

function buildOrderByClause<TEntity>(
  tableName: string,
  orderBy?: QueryOrder<TEntity> | QueryOrder<TEntity>[],
): string {
  const parts = normalizeOrderBy(orderBy).map(({ column, direction }) => {
    return `${qualifyColumn(tableName, column)} ${normalizeDirection(direction)}`;
  });

  return parts.length > 0 ? ` ORDER BY ${parts.join(", ")}` : "";
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

function buildReturningColumns<TEntity>(
  table: TableDefinition<TEntity>,
): string {
  return table.columns
    .map((column) => qualifyColumn(table.name, column))
    .join(", ");
}

function getDefinedColumnEntries<
  TEntity,
  PrimaryKey extends keyof TEntity & string,
>(
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

function buildSelectQuery<TEntity>(
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity> = {},
): { text: string; params: unknown[] } {
  const columns = buildReturningColumns(table);
  const { clause, params } = buildWhereClause(table.name, options.where);
  const orderBy = buildOrderByClause(
    table.name,
    options.orderBy ?? table.defaultOrderBy,
  );
  const limit = buildLimitClause(options.limit);

  return {
    text: `SELECT ${columns} FROM ${quoteIdentifier(table.name)}${clause}${orderBy}${limit}`,
    params,
  };
}

function buildCountQuery<TEntity>(
  table: TableDefinition<TEntity>,
  where: QueryWhere<TEntity> = {},
): { text: string; params: unknown[] } {
  const { clause, params } = buildWhereClause(table.name, where);

  return {
    text: `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}${clause}`,
    params,
  };
}

function buildProjectionQuery<TEntity>(
  table: TableDefinition<TEntity>,
  expression: string,
  alias: string,
  options: QueryOptions<TEntity> = {},
): { text: string; params: unknown[] } {
  const { clause, params } = buildWhereClause(table.name, options.where);
  const orderBy = buildOrderByClause(table.name, options.orderBy);
  const limit = buildLimitClause(options.limit);

  return {
    text: `SELECT ${expression} AS ${quoteIdentifier(alias)} FROM ${quoteIdentifier(table.name)}${clause}${orderBy}${limit}`,
    params,
  };
}

function buildGroupedCountQuery<TEntity, K extends keyof TEntity & string>(
  table: TableDefinition<TEntity>,
  column: K,
  where: QueryWhere<TEntity> = {},
): { text: string; params: unknown[] } {
  const qualifiedColumn = qualifyColumn(table.name, column);
  const { clause, params } = buildWhereClause(table.name, where);

  return {
    text: `SELECT ${qualifiedColumn} AS ${quoteIdentifier("value")}, COUNT(*) AS ${quoteIdentifier("count")} FROM ${quoteIdentifier(table.name)}${clause} GROUP BY ${qualifiedColumn} ORDER BY ${qualifiedColumn} ASC`,
    params,
  };
}

function buildInsertQuery<TEntity, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  values: MutationValues<TEntity>,
): { text: string; params: unknown[] } {
  const entries = getDefinedColumnEntries(table, values);

  if (entries.length === 0) {
    throw new Error(
      `Cannot insert into ${table.name} without any column values.`,
    );
  }

  const params: unknown[] = [];
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries
    .map(([, value]) => pushParam(params, value))
    .join(", ");
  const returningColumns = buildReturningColumns(table);

  return {
    text: `INSERT INTO ${quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders}) RETURNING ${returningColumns}`,
    params,
  };
}

function buildUpdateQuery<TEntity, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
  changes: UpdateValues<TEntity, PrimaryKey>,
): { text: string; params: unknown[] } {
  const entries = getDefinedColumnEntries(table, changes as Partial<TEntity>, {
    exclude: [table.primaryKey],
  });

  if (entries.length === 0) {
    throw new Error(
      `Cannot update ${table.name} without any changed column values.`,
    );
  }

  const params: unknown[] = [];
  const setClause = entries
    .map(
      ([column, value]) =>
        `${quoteIdentifier(column)} = ${pushParam(params, value)}`,
    )
    .join(", ");
  const primaryKeyPlaceholder = pushParam(params, id);
  const returningColumns = buildReturningColumns(table);

  return {
    text: `UPDATE ${quoteIdentifier(table.name)} SET ${setClause} WHERE ${quoteIdentifier(table.primaryKey)} = ${primaryKeyPlaceholder} RETURNING ${returningColumns}`,
    params,
  };
}

function buildDeleteByIdQuery<
  TEntity,
  PrimaryKey extends keyof TEntity & string,
>(
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
): { text: string; params: unknown[] } {
  return {
    text: `DELETE FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(table.primaryKey)} = $1 RETURNING ${quoteIdentifier(table.primaryKey)} AS ${quoteIdentifier("deleted_id")}`,
    params: [id],
  };
}

export {
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildInsertQuery,
  buildOrderByClause,
  buildProjectionQuery,
  buildSelectQuery,
  buildUpdateQuery,
  buildWhereClause,
  qualifyColumn,
  quoteIdentifier,
};
