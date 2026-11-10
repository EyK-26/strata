import type { SqlDialect } from "./sqlDialects.ts";
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

function quoteIdentifier(dialect: SqlDialect, identifier: string): string {
  return dialect.quoteIdentifier(identifier);
}

function returningSuffix(dialect: SqlDialect, columns: string): string {
  return dialect.returningClause(columns);
}

function qualifyColumn(dialect: SqlDialect, tableName: string, column: string): string {
  return `${quoteIdentifier(dialect, tableName)}.${quoteIdentifier(dialect, column)}`;
}

function resolveQualifiedColumn(
  dialect: SqlDialect,
  defaultTable: string,
  columnName: string,
): string {
  if (columnName.includes(".")) {
    const [table, column] = columnName.split(".", 2);

    if (!table || !column) {
      throw new Error(`Invalid qualified column: ${columnName}`);
    }

    return qualifyColumn(dialect, table, column);
  }

  return qualifyColumn(dialect, defaultTable, columnName);
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

function pushParam(dialect: SqlDialect, values: unknown[], value: unknown): string {
  values.push(value);
  return dialect.placeholder(values.length);
}

const SUPPORTED_OPERATORS: ReadonlySet<string> = new Set([
  "eq",
  "ne",
  "in",
  "notIn",
  "gt",
  "gte",
  "lt",
  "lte",
  "isNull",
  "ilike",
  "tsMatch",
]);

function buildInClause(
  dialect: SqlDialect,
  column: string,
  values: readonly unknown[],
  params: unknown[],
  negated = false,
): string {
  if (values.length === 0) {
    return negated ? "1 = 1" : "1 = 0";
  }

  const placeholders = values.map((value) => pushParam(dialect, params, value)).join(", ");
  return `${column}${negated ? " NOT" : ""} IN (${placeholders})`;
}

function buildOperatorClauses(
  dialect: SqlDialect,
  column: string,
  operator: QueryOperator,
  params: unknown[],
): string[] {
  const clauses: string[] = [];

  const unsupported = Object.keys(operator).filter((key) => !SUPPORTED_OPERATORS.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported query operator(s) for ${column}: ${unsupported.join(", ")}. Supported: ${[...SUPPORTED_OPERATORS].join(", ")}.`,
    );
  }

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
      clauses.push(`${column} = ${pushParam(dialect, params, operator.eq)}`);
    }
  }

  if (operator.ne !== undefined) {
    if (operator.ne === null) {
      clauses.push(`${column} IS NOT NULL`);
    } else {
      clauses.push(`${column} <> ${pushParam(dialect, params, operator.ne)}`);
    }
  }

  if (operator.in !== undefined) {
    clauses.push(buildInClause(dialect, column, operator.in, params));
  }

  if (operator.notIn !== undefined) {
    clauses.push(buildInClause(dialect, column, operator.notIn, params, true));
  }

  if (operator.gt !== undefined) {
    clauses.push(`${column} > ${pushParam(dialect, params, operator.gt)}`);
  }

  if (operator.gte !== undefined) {
    clauses.push(`${column} >= ${pushParam(dialect, params, operator.gte)}`);
  }

  if (operator.lt !== undefined) {
    clauses.push(`${column} < ${pushParam(dialect, params, operator.lt)}`);
  }

  if (operator.lte !== undefined) {
    clauses.push(`${column} <= ${pushParam(dialect, params, operator.lte)}`);
  }

  if (operator.ilike !== undefined) {
    clauses.push(
      `${column} ${dialect.ilikeOperator()} ${pushParam(dialect, params, operator.ilike)}`,
    );
  }

  if (operator.tsMatch !== undefined) {
    if (dialect.driver !== "pgsql") {
      throw new Error("Full-text search (tsMatch) is only available on PostgreSQL.");
    }

    clauses.push(
      `${column} @@ plainto_tsquery('english', ${pushParam(dialect, params, operator.tsMatch)})`,
    );
  }

  return clauses;
}

function appendWhereParts<TEntity extends object>(
  dialect: SqlDialect,
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

    const column = resolveQualifiedColumn(dialect, tableName, columnName);

    if (Array.isArray(filterValue)) {
      clauses.push(buildInClause(dialect, column, filterValue, params));
      continue;
    }

    if (isQueryOperator(filterValue)) {
      clauses.push(...buildOperatorClauses(dialect, column, filterValue, params));
      continue;
    }

    if (filterValue === null) {
      clauses.push(`${column} IS NULL`);
      continue;
    }

    clauses.push(`${column} = ${pushParam(dialect, params, filterValue)}`);
  }

  return clauses.join(" AND ");
}

function buildWhereClause<TEntity extends object>(
  dialect: SqlDialect,
  tableName: string,
  where: QueryWhere<TEntity> = {},
): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const body = appendWhereParts(dialect, tableName, where, params);

  return {
    clause: body.length > 0 ? ` WHERE ${body}` : "",
    params,
  };
}

function remapExistsSql(sql: string, existsParams: readonly unknown[], params: unknown[]): string {
  const offset = params.length;
  params.push(...existsParams);
  return sql.replace(/\$(\d+)/g, (_match, index: string) => `$${offset + Number(index)}`);
}

function buildWhereNodeClause<TEntity extends object>(
  dialect: SqlDialect,
  tableName: string,
  node: WhereNode<TEntity>,
  params: unknown[],
): string {
  if ("compareRow" in node) {
    const { columns, operator, values } = node.compareRow;
    if (
      !Array.isArray(columns) ||
      !columns.length ||
      !Array.isArray(values) ||
      columns.length !== values.length ||
      !["lt", "gt"].includes(operator) ||
      Array.from(columns).some((column) => typeof column !== "string" || !column.length)
    )
      throw new TypeError("Invalid row comparison columns, values or operator.");
    return `(${columns.map((column) => qualifyColumn(dialect, tableName, column)).join(", ")}) ${operator === "lt" ? "<" : ">"} (${values.map((value) => pushParam(dialect, params, value)).join(", ")})`;
  }

  if ("exists" in node) {
    const body = remapExistsSql(node.exists.sql, node.exists.params, params);
    return `${node.exists.not ? "NOT " : ""}EXISTS (${body})`;
  }

  if ("where" in node) {
    return appendWhereParts(dialect, tableName, node.where, params);
  }

  const grouped = buildWhereGroupClause(dialect, tableName, node.group, params);

  if (!grouped) {
    return "";
  }

  return grouped.includes(" OR ") ? `(${grouped})` : grouped;
}

function buildWhereGroupClause<TEntity extends object>(
  dialect: SqlDialect,
  tableName: string,
  nodes: readonly WhereNode<TEntity>[],
  params: unknown[],
): string {
  let result = "";

  for (const node of nodes) {
    const part = buildWhereNodeClause(dialect, tableName, node, params);

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
  dialect: SqlDialect,
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

  const combined = buildWhereGroupClause(dialect, tableName, nodes, params);

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

function appendSoftDeleteScope<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed">,
  clauses: string[],
): void {
  const column = resolveSoftDeleteColumn(table);

  if (!column) {
    return;
  }

  const qualifiedColumn = qualifyColumn(dialect, table.name, column);

  if (options.onlyTrashed) {
    clauses.push(`${qualifiedColumn} IS NOT NULL`);
    return;
  }

  if (!options.withTrashed) {
    clauses.push(`${qualifiedColumn} IS NULL`);
  }
}

function buildQueryWhereClause<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: Pick<QueryOptions<TEntity>, "where" | "withTrashed" | "onlyTrashed"> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
  params: unknown[] = [],
): { clause: string; params: unknown[] } {
  const { clause, params: whereParams } = buildAdvancedWhereClause(
    dialect,
    table.name,
    options.where ?? {},
    whereNodes,
    params,
  );
  const softDeleteClauses: string[] = [];

  appendSoftDeleteScope(dialect, table, options, softDeleteClauses);

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

function normalizeOrderBy<TEntity extends object>(
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
  dialect: SqlDialect,
  tableName: string,
  orderBy?: QueryOptions<TEntity>["orderBy"],
): string {
  const parts = normalizeOrderBy(orderBy).map(({ column, direction, nulls }) => {
    if (nulls !== undefined && nulls !== "first" && nulls !== "last") {
      throw new TypeError("Invalid null ordering: expected first or last.");
    }
    const reference = resolveQualifiedColumn(dialect, tableName, column);
    const ordered = `${reference} ${normalizeDirection(direction)}`;
    if (nulls === undefined) return ordered;
    // MySQL lacks NULLS FIRST/LAST. A null discriminator precedes the value
    // in the same order item, leaving subsequent tie-breakers unchanged.
    if (dialect.driver === "mysql") {
      return `(${reference} IS NULL) ${nulls === "first" ? "DESC" : "ASC"}, ${ordered}`;
    }
    return `${ordered} NULLS ${nulls.toUpperCase()}`;
  });

  return parts.length > 0 ? ` ORDER BY ${parts.join(", ")}` : "";
}

function buildGroupByClause<TEntity extends object>(
  dialect: SqlDialect,
  tableName: string,
  groupBy?: QueryOptions<TEntity>["groupBy"],
): string {
  if (!groupBy) {
    return "";
  }

  const columns = (Array.isArray(groupBy) ? groupBy : [groupBy]).map((column) => String(column));
  const parts = columns.map((column) => resolveQualifiedColumn(dialect, tableName, column));
  return parts.length > 0 ? ` GROUP BY ${parts.join(", ")}` : "";
}

function buildHavingClause<TEntity extends object>(
  dialect: SqlDialect,
  tableName: string,
  having: QueryOptions<TEntity>["having"],
  params: unknown[],
): string {
  if (!having) {
    return "";
  }

  const body = appendWhereParts(dialect, tableName, having, params);
  return body.length > 0 ? ` HAVING ${body}` : "";
}

function buildJoinClause(dialect: SqlDialect, joins: readonly QueryJoin[] = []): string {
  return joins
    .map((join) => {
      const joinType = join.type === "left" ? "LEFT JOIN" : "INNER JOIN";
      const onClause = join.on
        .map(
          ({ left, right }) =>
            `${qualifyColumn(dialect, left.table, left.column)} = ${qualifyColumn(dialect, right.table, right.column)}`,
        )
        .join(" AND ");

      return ` ${joinType} ${quoteIdentifier(dialect, join.table)} ON ${onClause}`;
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

function buildReturningColumns<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
): string {
  return table.columns.map((column) => qualifyColumn(dialect, table.name, column)).join(", ");
}

function buildSelectList<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  select?: QuerySelectItem[],
  params: unknown[] = [],
): string {
  if (!select || select.length === 0) {
    return buildReturningColumns(dialect, table);
  }

  return select
    .map((item) => {
      if (item.kind === "column") {
        const column = qualifyColumn(dialect, item.table, item.column);
        return item.as ? `${column} AS ${quoteIdentifier(dialect, item.as)}` : column;
      }

      if (item.kind === "textColumn") {
        const column = qualifyColumn(dialect, item.table, item.column);
        // SQLite's ordinary REAL-to-TEXT cast rounds to 15 significant digits.
        const text =
          dialect.driver === "sqlite"
            ? `CASE WHEN typeof(${column}) = 'real' THEN printf('%!.26g', ${column}) ELSE ${dialect.castToText(column)} END`
            : dialect.castToText(column);
        return `${text} AS ${quoteIdentifier(dialect, item.as)}`;
      }

      if (item.kind === "literalText") {
        return `${dialect.castToText(pushParam(dialect, params, item.value))} AS ${quoteIdentifier(dialect, item.as)}`;
      }

      if (item.kind === "subqueryCount") {
        const body = remapExistsSql(item.sql, item.params, params);
        return `(${body}) AS ${quoteIdentifier(dialect, item.as)}`;
      }

      const column = qualifyColumn(dialect, item.table, item.column);
      const placeholder = pushParam(dialect, params, item.query);
      return `ts_rank(${column}, plainto_tsquery('english', ${placeholder})) AS ${quoteIdentifier(dialect, item.as)}`;
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

function buildSelectLock<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity>,
): string {
  const lock = options.lock;
  if (!lock) return "";
  const driver = dialect.driver;
  if (driver === "sqlite")
    throw new Error("Row locks are not supported on SQLite; use an explicit write transaction.");
  if (lock.mode !== "update" && lock.mode !== "share")
    throw new TypeError("Invalid row lock mode.");
  if (lock.wait !== undefined && !["wait", "nowait", "skipLocked"].includes(lock.wait))
    throw new TypeError("Invalid row lock wait policy.");
  if (options.groupBy || options.having)
    throw new Error("Row locks cannot be combined with grouped/aggregate queries.");
  let target = "";
  if (lock.of !== undefined) {
    if (driver !== "pgsql") throw new Error("Row lock targets are supported only on PostgreSQL.");
    const tables = [table.name, ...(options.joins ?? []).map((join) => join.table)];
    if (!lock.of.length || lock.of.some((name) => !tables.includes(name)))
      throw new TypeError("Row lock targets must name tables in this query.");
    target = ` OF ${lock.of.map((column) => quoteIdentifier(dialect, column)).join(", ")}`;
  }
  const wait =
    lock.wait === "nowait" ? " NOWAIT" : lock.wait === "skipLocked" ? " SKIP LOCKED" : "";
  return ` FOR ${lock.mode === "update" ? "UPDATE" : "SHARE"}${target}${wait}`;
}

function buildSelectQuery<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const columns = buildSelectList(dialect, table, options.select, params);
  const { clause } = buildQueryWhereClause(dialect, table, options, whereNodes, params);
  const joins = buildJoinClause(dialect, options.joins);
  const groupBy = buildGroupByClause(dialect, table.name, options.groupBy);
  const havingClause = buildHavingClause(dialect, table.name, options.having, params);
  const orderBy = buildOrderByClause(dialect, table.name, options.orderBy ?? table.defaultOrderBy);
  const limit = buildLimitClause(options.limit);
  const offset = buildOffsetClause(options.offset);
  const lock = buildSelectLock(dialect, table, options);

  return {
    text: `SELECT ${columns} FROM ${quoteIdentifier(dialect, table.name)}${joins}${clause}${groupBy}${havingClause}${orderBy}${limit}${offset}${lock}`,
    params,
  };
}

const EAGER_ROW_NUMBER = "__strata_eager_row_number";

/** Database-side per-owner bounds; never fetch an unbounded batch to slice in JS. */
function buildLimitedRelationQuery<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity>,
  partition: { table: string; column: string },
  source: (columns: string, rank: string, params: unknown[]) => string,
): { text: string; params: unknown[] } {
  if (options.lock || options.groupBy?.length || options.having) {
    throw new Error("Limited eager relations do not support row locks, grouping or HAVING.");
  }
  if (
    table.columns.includes(EAGER_ROW_NUMBER as keyof TEntity & string) ||
    options.select?.some((item) => "as" in item && item.as === EAGER_ROW_NUMBER)
  ) {
    throw new Error(`Reserved eager relation column: ${EAGER_ROW_NUMBER}`);
  }
  buildLimitClause(options.limit);
  buildOffsetClause(options.offset);
  if (!Number.isSafeInteger((options.offset ?? 0) + (options.limit ?? 0))) {
    throw new Error("Limited eager relation bounds must fit a safe integer.");
  }
  const order = [...normalizeOrderBy(options.orderBy ?? table.defaultOrderBy)];
  if (
    !order.some(
      (item) =>
        item.column === table.primaryKey || item.column === `${table.name}.${table.primaryKey}`,
    )
  ) {
    order.push({ column: table.primaryKey, direction: "ASC" });
  }
  const ordering = buildOrderByClause(dialect, table.name, order);
  const params: unknown[] = [];
  const columns = buildSelectList(dialect, table, options.select, params);
  const rank = `ROW_NUMBER() OVER (PARTITION BY ${qualifyColumn(dialect, partition.table, partition.column)}${ordering}) AS ${quoteIdentifier(dialect, EAGER_ROW_NUMBER)}`;
  const sql = source(columns, rank, params);
  const offset = options.offset ?? 0;
  const upper =
    options.limit === undefined
      ? ""
      : ` AND ${quoteIdentifier(dialect, EAGER_ROW_NUMBER)} <= ${offset + options.limit}`;
  return {
    text: `SELECT * FROM (${sql}) AS ${quoteIdentifier(dialect, "__strata_eager")} WHERE ${quoteIdentifier(dialect, EAGER_ROW_NUMBER)} > ${offset}${upper} ORDER BY ${quoteIdentifier(dialect, EAGER_ROW_NUMBER)}`,
    params,
  };
}

function buildLimitedHasManyQuery<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  options: QueryOptions<TEntity>,
  partition: { table: string; column: string; ownerAlias?: string },
): { text: string; params: unknown[] } {
  return buildLimitedRelationQuery(dialect, table, options, partition, (columns, rank, params) => {
    const { clause } = buildQueryWhereClause(dialect, table, options, options.whereNodes, params);
    const owner = partition.ownerAlias
      ? `, ${qualifyColumn(dialect, partition.table, partition.column)} AS ${quoteIdentifier(dialect, partition.ownerAlias)}`
      : "";
    return `SELECT ${columns}${owner}, ${rank} FROM ${quoteIdentifier(dialect, table.name)}${buildJoinClause(dialect, options.joins)}${clause}`;
  });
}

function buildCountQuery<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  where: QueryWhere<TEntity> = {},
  options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed" | "joins" | "groupBy"> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const { clause, params: whereParams } = buildQueryWhereClause(
    dialect,
    table,
    {
      where,
      withTrashed: options.withTrashed,
      onlyTrashed: options.onlyTrashed,
    },
    whereNodes,
  );
  params.push(...whereParams);
  const joins = buildJoinClause(dialect, options.joins);
  const groupBy = buildGroupByClause(dialect, table.name, options.groupBy);

  return {
    text: `SELECT COUNT(*) AS count FROM ${quoteIdentifier(dialect, table.name)}${joins}${clause}${groupBy}`,
    params,
  };
}

function buildProjectionQuery<TEntity extends object>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  expression: string,
  alias: string,
  options: QueryOptions<TEntity> = {},
  whereNodes: readonly WhereNode<TEntity>[] = [],
): { text: string; params: unknown[] } {
  assertSafeProjectionExpression(expression);
  const params: unknown[] = [];
  const { clause, params: whereParams } = buildQueryWhereClause(
    dialect,
    table,
    options,
    whereNodes,
  );
  params.push(...whereParams);
  const joins = buildJoinClause(dialect, options.joins);
  const groupBy = buildGroupByClause(dialect, table.name, options.groupBy);
  const orderBy = buildOrderByClause(dialect, table.name, options.orderBy);
  const limit = buildLimitClause(options.limit);

  return {
    text: `SELECT ${expression} AS ${quoteIdentifier(dialect, alias)} FROM ${quoteIdentifier(dialect, table.name)}${joins}${clause}${groupBy}${orderBy}${limit}`,
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

/** Fixed aliases and textual totals avoid driver-dependent JavaScript precision loss. */
function buildGroupedSumQuery<TEntity extends object, K extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  groupColumn: K,
  column: keyof TEntity & string,
  options: QueryOptions<TEntity> = {},
  whereNodes: readonly WhereNode<TEntity>[] = options.whereNodes ?? [],
): { text: string; params: unknown[] } {
  if (!table.columns.includes(groupColumn) || !table.columns.includes(column))
    throw new TypeError("Grouped sums require declared columns.");
  for (const key of Object.keys(options))
    if (!["where", "whereNodes", "withTrashed", "onlyTrashed"].includes(key))
      throw new TypeError(
        "Grouped sums do not support joins, selection, ordering, pagination, grouping or locks.",
      );
  const group = qualifyColumn(dialect, table.name, groupColumn);
  const total = dialect.castToText(`SUM(${qualifyColumn(dialect, table.name, column)})`);
  const { clause, params } = buildQueryWhereClause(dialect, table, options, whereNodes);
  return {
    text: `SELECT ${group} AS ${quoteIdentifier(dialect, "value")}, ${total} AS ${quoteIdentifier(dialect, "sum")} FROM ${quoteIdentifier(dialect, table.name)}${clause} GROUP BY ${group} ORDER BY ${group} ASC`,
    params,
  };
}

function buildGroupedCountQuery<TEntity extends object, K extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity>,
  column: K,
  where: QueryWhere<TEntity> = {},
  options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed"> = {},
): { text: string; params: unknown[] } {
  const qualifiedColumn = qualifyColumn(dialect, table.name, column);
  const { clause, params } = buildQueryWhereClause(dialect, table, {
    where,
    ...options,
  });

  return {
    text: `SELECT ${qualifiedColumn} AS ${quoteIdentifier(dialect, "value")}, COUNT(*) AS ${quoteIdentifier(dialect, "count")} FROM ${quoteIdentifier(dialect, table.name)}${clause} GROUP BY ${qualifiedColumn} ORDER BY ${qualifiedColumn} ASC`,
    params,
  };
}

function buildInsertQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  values: MutationValues<TEntity>,
): { text: string; params: unknown[] } {
  const entries = getDefinedColumnEntries(table, values);

  if (entries.length === 0) {
    throw new Error(`Cannot insert into ${table.name} without any column values.`);
  }

  const params: unknown[] = [];
  const columns = entries.map(([column]) => quoteIdentifier(dialect, column)).join(", ");
  const placeholders = entries.map(([, value]) => pushParam(dialect, params, value)).join(", ");
  const returningColumns = buildReturningColumns(dialect, table);

  return {
    text: `INSERT INTO ${quoteIdentifier(dialect, table.name)} (${columns}) VALUES (${placeholders})${returningSuffix(dialect, returningColumns)}`,
    params,
  };
}

function buildUpsertQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  values: MutationValues<TEntity>,
  conflictColumns: readonly string[],
  updateColumns?: readonly string[],
): { text: string; params: unknown[] } {
  const entries = getDefinedColumnEntries(table, values);

  if (entries.length === 0) {
    throw new Error(`Cannot upsert into ${table.name} without any column values.`);
  }

  if (conflictColumns.length === 0) {
    throw new Error(`Cannot upsert into ${table.name} without any conflict columns.`);
  }

  const insertable = new Set(entries.map(([column]) => column as string));
  const conflict = new Set(conflictColumns as readonly string[]);
  const updatable = (
    updateColumns ?? entries.map(([column]) => column as string).filter((c) => !conflict.has(c))
  ).filter((column) => insertable.has(column));

  const params: unknown[] = [];
  const columns = entries.map(([column]) => quoteIdentifier(dialect, column)).join(", ");
  const placeholders = entries.map(([, value]) => pushParam(dialect, params, value)).join(", ");
  const returningColumns = buildReturningColumns(dialect, table);
  const suffix = dialect.upsertSuffix(conflictColumns, updatable);

  return {
    text: `INSERT INTO ${quoteIdentifier(dialect, table.name)} (${columns}) VALUES (${placeholders})${suffix}${returningSuffix(dialect, returningColumns)}`,
    params,
  };
}

function buildIncrementQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
  column: keyof TEntity & string,
  amount: number,
  extra: UpdateValues<TEntity, PrimaryKey> = {} as UpdateValues<TEntity, PrimaryKey>,
): { text: string; params: unknown[] } {
  if (!Number.isFinite(amount)) {
    throw new Error("Increment amount must be a finite number.");
  }

  if (!table.columns.includes(column)) {
    throw new Error(`Unknown column ${String(column)} on ${table.name}.`);
  }

  const params: unknown[] = [];
  const target = quoteIdentifier(dialect, column);
  const assignments = [`${target} = ${target} + ${pushParam(dialect, params, amount)}`];

  for (const [name, value] of getDefinedColumnEntries(table, extra as Partial<TEntity>, {
    exclude: [table.primaryKey, column],
  })) {
    assignments.push(`${quoteIdentifier(dialect, name)} = ${pushParam(dialect, params, value)}`);
  }

  const primaryKeyPlaceholder = pushParam(dialect, params, id);
  const returningColumns = buildReturningColumns(dialect, table);
  const scopeClauses: string[] = [];

  appendSoftDeleteScope(dialect, table, {}, scopeClauses);

  const scopeSuffix = scopeClauses.length > 0 ? ` AND ${scopeClauses.join(" AND ")}` : "";

  return {
    text: `UPDATE ${quoteIdentifier(dialect, table.name)} SET ${assignments.join(", ")} WHERE ${quoteIdentifier(dialect, table.primaryKey)} = ${primaryKeyPlaceholder}${scopeSuffix}${returningSuffix(dialect, returningColumns)}`,
    params,
  };
}

function buildUpdateQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  dialect: SqlDialect,
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
    .map(
      ([column, value]) =>
        `${quoteIdentifier(dialect, column)} = ${pushParam(dialect, params, value)}`,
    )
    .join(", ");
  const primaryKeyPlaceholder = pushParam(dialect, params, id);
  const returningColumns = buildReturningColumns(dialect, table);
  const scopeClauses: string[] = [];

  appendSoftDeleteScope(dialect, table, {}, scopeClauses);

  const scopeSuffix = scopeClauses.length > 0 ? ` AND ${scopeClauses.join(" AND ")}` : "";

  return {
    text: `UPDATE ${quoteIdentifier(dialect, table.name)} SET ${setClause} WHERE ${quoteIdentifier(dialect, table.primaryKey)} = ${primaryKeyPlaceholder}${scopeSuffix}${returningSuffix(dialect, returningColumns)}`,
    params,
  };
}

function buildSoftDeleteByIdQuery<
  TEntity extends object,
  PrimaryKey extends keyof TEntity & string,
>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
  deletedAt: Date,
): { text: string; params: unknown[] } {
  const deletedAtColumn = resolveSoftDeleteColumn(table);

  if (!deletedAtColumn) {
    throw new Error(`Table ${table.name} does not support soft deletes.`);
  }

  const returningColumns = buildReturningColumns(dialect, table);
  const scopeClauses: string[] = [];
  appendSoftDeleteScope(dialect, table, {}, scopeClauses);
  const scopeSuffix = scopeClauses.length > 0 ? ` AND ${scopeClauses.join(" AND ")}` : "";
  const params: unknown[] = [];
  const deletedAtPlaceholder = pushParam(dialect, params, deletedAt);
  const idPlaceholder = pushParam(dialect, params, id);

  return {
    text: `UPDATE ${quoteIdentifier(dialect, table.name)} SET ${quoteIdentifier(dialect, deletedAtColumn)} = ${deletedAtPlaceholder} WHERE ${quoteIdentifier(dialect, table.primaryKey)} = ${idPlaceholder}${scopeSuffix}${returningSuffix(dialect, returningColumns)}`,
    params,
  };
}

function buildRestoreByIdQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
): { text: string; params: unknown[] } {
  const deletedAtColumn = resolveSoftDeleteColumn(table);

  if (!deletedAtColumn) {
    throw new Error(`Table ${table.name} does not support soft deletes.`);
  }

  const returningColumns = buildReturningColumns(dialect, table);
  const params: unknown[] = [];
  const deletedAtPlaceholder = pushParam(dialect, params, null);
  const idPlaceholder = pushParam(dialect, params, id);

  return {
    text: `UPDATE ${quoteIdentifier(dialect, table.name)} SET ${quoteIdentifier(dialect, deletedAtColumn)} = ${deletedAtPlaceholder} WHERE ${quoteIdentifier(dialect, table.primaryKey)} = ${idPlaceholder} AND ${qualifyColumn(dialect, table.name, deletedAtColumn)} IS NOT NULL${returningSuffix(dialect, returningColumns)}`,
    params,
  };
}

function buildDeleteByIdQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  id: TEntity[PrimaryKey],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const idPlaceholder = pushParam(dialect, params, id);
  const returning = returningSuffix(
    dialect,
    `${quoteIdentifier(dialect, table.primaryKey)} AS ${quoteIdentifier(dialect, "deleted_id")}`,
  );

  return {
    text: `DELETE FROM ${quoteIdentifier(dialect, table.name)} WHERE ${quoteIdentifier(dialect, table.primaryKey)} = ${idPlaceholder}${returning}`,
    params,
  };
}

/** Single-statement writes: predicates and protected scopes stay in the mutation. */
function buildConditionalWriteQuery<
  TEntity extends object,
  PrimaryKey extends keyof TEntity & string,
>(
  dialect: SqlDialect,
  table: TableDefinition<TEntity, PrimaryKey>,
  operation: "update" | "delete",
  changes: UpdateValues<TEntity, PrimaryKey>,
  options: QueryOptions<TEntity>,
  returning?: readonly (keyof TEntity & string)[],
): { text: string; params: unknown[] } {
  for (const key of [
    "joins",
    "groupBy",
    "having",
    "select",
    "orderBy",
    "limit",
    "offset",
    "lock",
  ] as const) {
    if (options[key] !== undefined) throw new Error(`Conditional writes do not support ${key}.`);
  }
  const params: unknown[] = [];
  const predicate = buildAdvancedWhereClause(
    dialect,
    table.name,
    options.where ?? {},
    options.whereNodes ?? [],
  );
  if (!predicate.clause) throw new Error("Conditional writes require an explicit predicate.");
  if (returning !== undefined && dialect.driver === "mysql")
    throw new Error("Mutation RETURNING is not supported on MySQL.");
  const columns = returning ?? [table.primaryKey];
  if (!columns.length || columns.some((column) => !table.columns.includes(column)))
    throw new Error("RETURNING columns must be nonempty declared table columns.");
  const deletedAt = resolveSoftDeleteColumn(table);
  const values = operation === "delete" && deletedAt ? { [deletedAt]: new Date() } : changes;
  let prefix: string;
  if (operation === "update" || deletedAt) {
    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    if (!entries.length) throw new Error("Conditional updates require at least one value.");
    if (
      entries.some(
        ([column]) =>
          column === table.primaryKey || !table.columns.includes(column as keyof TEntity & string),
      )
    )
      throw new Error("Conditional updates require declared non-primary-key columns.");
    const assignments = entries.map(
      ([column, value]) =>
        `${quoteIdentifier(dialect, column)} = ${pushParam(dialect, params, value)}`,
    );
    prefix = `UPDATE ${quoteIdentifier(dialect, table.name)} SET ${assignments.join(", ")}`;
  } else prefix = `DELETE FROM ${quoteIdentifier(dialect, table.name)}`;
  const { clause } = buildQueryWhereClause(
    dialect,
    table,
    options,
    options.whereNodes ?? [],
    params,
  );
  return {
    text:
      prefix +
      clause +
      returningSuffix(
        dialect,
        columns.map((column) => quoteIdentifier(dialect, column)).join(", "),
      ),
    params,
  };
}

export {
  assertSafeProjectionExpression,
  buildAdvancedWhereClause,
  buildConditionalWriteQuery,
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildGroupedSumQuery,
  buildIncrementQuery,
  buildInsertQuery,
  buildJoinClause,
  buildLimitedHasManyQuery,
  buildLimitedRelationQuery,
  buildOrderByClause,
  buildProjectionQuery,
  buildQueryWhereClause,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  buildUpsertQuery,
  buildWhereClause,
  EAGER_ROW_NUMBER,
  parseQualifiedColumn,
  qualifyColumn,
  quoteIdentifier,
  resolveQualifiedColumn,
  resolveSoftDeleteColumn,
};
