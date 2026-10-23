import { eventBus } from "../events/eventBus.ts";
import { dispatchModelEvent, modelEventName } from "../events/index.ts";
import type { KeysetCursor, KeysetOptions } from "../pagination/index.ts";
import {
  buildPaginationMeta,
  type CursorPaginatedResult,
  type PaginatedResult,
} from "../pagination/index.ts";
import type { DatabaseConnection, SqlDatabaseConnection } from "./connectionContracts";
import { currentSqlDialect } from "./dialect.ts";
import { withDatabaseErrorHandling } from "./errors.ts";
import { KEYSET_ALIAS_PREFIX, keysetBoundary, validateKeyset } from "./keyset.ts";
import {
  buildConditionalWriteQuery,
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildGroupedSumQuery,
  buildIncrementQuery,
  buildInsertQuery,
  buildLimitedHasManyQuery,
  buildProjectionQuery,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  buildUpsertQuery,
  EAGER_ROW_NUMBER,
  qualifyColumn,
  resolveSoftDeleteColumn,
} from "./query.ts";
import { buildHasManyThroughQuery, buildPivotLookupQuery } from "./relationQueries.ts";
import {
  type BelongsToManyRelation,
  type BelongsToRelation,
  getByRelationKey,
  type HasManyRelation,
  type HasManyThroughRelation,
  indexBelongsToManyRelation,
  indexBelongsToRelation,
  indexHasManyRelation,
  indexHasManyThroughRelation,
  indexMorphManyRelation,
  indexMorphToRelation,
  type MorphManyRelation,
  type MorphOneRelation,
  type MorphToRelation,
  relationMatchKey,
} from "./relationships.ts";
import { repositoryConnection } from "./repositoryConnection";
import { RepositoryQuery } from "./repositoryQuery.ts";
import type { TableDefinition } from "./table.ts";
import { isActiveTransactionConnection, runInTransaction } from "./transaction.ts";
import { hasActiveTransaction } from "./transactionControl.ts";
import type {
  MutationValues,
  QueryOptions,
  QueryOrder,
  QueryWhere,
  UpdateValues,
} from "./types.ts";
import type { WhereNode } from "./whereBuilder.ts";

type ExtendedQueryOptions<TEntity extends object> = QueryOptions<TEntity> & {
  whereNodes?: WhereNode<TEntity>[];
};

function listOrders<TEntity extends object>(
  orderBy:
    | QueryOptions<TEntity>["orderBy"]
    | QueryOrder<TEntity>
    | QueryOrder<TEntity>[]
    | undefined,
): Array<{ column: string; direction: "asc" | "desc"; nulls?: string }> {
  if (!orderBy) return [];
  if (Array.isArray(orderBy)) return orderBy.map(readOrder);
  if ("column" in orderBy) return [readOrder(orderBy)];
  return Object.entries(orderBy as Record<string, unknown>).flatMap(([column, direction]) => {
    if (direction === undefined) return [];
    return [
      {
        column,
        direction:
          String(direction).toUpperCase() === "DESC" ? ("desc" as const) : ("asc" as const),
      },
    ];
  });
}

function readOrder<TEntity extends object>(
  order: QueryOrder<TEntity>,
): {
  column: string;
  direction: "asc" | "desc";
  nulls?: string;
} {
  return {
    column: String(order.column),
    direction: String(order.direction).toUpperCase() === "DESC" ? "desc" : "asc",
    ...(order.nulls === undefined ? {} : { nulls: order.nulls }),
  };
}

type CountRow = { count: number | string };
type ValueCountRow<TValue> = { value: TValue | null; count: number | string };
type DeletedRow = { deleted_id: string | number };

type ErrorFactory<TValue> = (value: TValue) => Error;

// Enumerable symbol metadata survives ordinary subclass option spreading while
// keeping this execution detail out of the public QueryOptions contract.
const RELATION_WINDOW = Symbol("relationWindow");
type RelationWindowOptions<TEntity extends object> = ExtendedQueryOptions<TEntity> & {
  [RELATION_WINDOW]?: { table: string; column: string; ownerAlias?: string };
};

class BaseRepository<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  constructor(
    protected readonly table: TableDefinition<TEntity, PrimaryKey>,
    protected readonly connection: DatabaseConnection = repositoryConnection,
  ) {}

  private assertTransactionalEvent(action: string): void {
    if (!eventBus.hasTransactionalListeners(modelEventName(this.table.name, action))) return;
    if (
      !hasActiveTransaction() ||
      (this.connection !== repositoryConnection && !isActiveTransactionConnection(this.connection))
    )
      throw new Error(
        "Transactional model listeners require runInTransaction and the framework-bound repository connection before writing.",
      );
  }

  private async runModelMutation<T>(action: string, operation: () => Promise<T>): Promise<T> {
    if (!eventBus.hasTransactionalListeners(modelEventName(this.table.name, action)))
      return operation();
    // A caught listener/publication failure must roll back its row write as well.
    return runInTransaction(operation);
  }

  private mysqlMutation<T>(operation: (repository: this) => Promise<T>): Promise<T> {
    return runInTransaction(
      (db) => operation(this.withConnection(db)),
      this.connection === repositoryConnection ? {} : { connection: this.connection },
    );
  }

  private mysqlRow(id: unknown, onlyTrashed = false): Promise<TEntity | null> {
    if (id === undefined || id === null)
      throw new Error(
        `MySQL write to ${this.table.name} did not identify its persisted primary key.`,
      );
    return this.firstOrNull({ [this.table.primaryKey]: id } as QueryWhere<TEntity>, {
      withTrashed: true,
      ...(onlyTrashed ? { onlyTrashed: true } : {}),
    });
  }

  private mysqlAffected(row: { affectedRows?: number } | undefined): number {
    const count = row?.affectedRows;
    if (count === undefined || !Number.isSafeInteger(count) || count < 0)
      throw new Error("MySQL mutations require affectedRows metadata from the framework adapter.");
    return count;
  }

  private async mysqlWriteById(
    query: { text: string; params: unknown[] },
    id: TEntity[PrimaryKey],
    onlyTrashed = false,
    allowUnchanged = false,
  ): Promise<TEntity | null> {
    const [row] = await this.connection.unsafe<{ affectedRows?: number }>(query.text, query.params);
    if (!this.mysqlAffected(row)) {
      if (!allowUnchanged) return null;
      // mysql2 can report changed rows instead of matched rows. An unchanged
      // update still returns its live row; default scopes exclude deleted rows.
      return this.findById(id);
    }
    return this.mysqlRow(id, onlyTrashed);
  }

  async count(options: ExtendedQueryOptions<TEntity> = {}): Promise<number> {
    if (options.lock) throw new Error("Row locks require a row selection, not count().");
    const { whereNodes, where, ...rest } = options;
    return await this.countWhere(where ?? {}, rest, whereNodes ?? []);
  }

  async findAll(options: ExtendedQueryOptions<TEntity> = {}): Promise<TEntity[]> {
    return await withDatabaseErrorHandling(async () => {
      if (
        options.lock &&
        (!hasActiveTransaction() ||
          (this.connection !== repositoryConnection &&
            !isActiveTransactionConnection(this.connection)))
      ) {
        throw new Error("Row locks require the framework active transaction connection.");
      }
      const {
        whereNodes,
        [RELATION_WINDOW]: window,
        ...queryOptions
      } = options as RelationWindowOptions<TEntity>;
      const { text, params } = window
        ? buildLimitedHasManyQuery(this.table, { ...queryOptions, whereNodes }, window)
        : buildSelectQuery(this.table, queryOptions, whereNodes ?? []);
      const rows = await this.connection.unsafe<TEntity & Record<string, unknown>>(text, params);
      if (window) for (const row of rows) delete row[EAGER_ROW_NUMBER];
      return rows;
    });
  }

  async paginate(
    options: {
      page: number;
      perPage: number;
    } & Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset">,
  ): Promise<PaginatedResult<TEntity>> {
    const { whereNodes, where = {}, page, perPage, ...queryOptions } = options;
    const total = await this.countWhere(
      where,
      {
        withTrashed: options.withTrashed,
        onlyTrashed: options.onlyTrashed,
        joins: options.joins,
        groupBy: options.groupBy,
      },
      whereNodes,
    );
    const meta = buildPaginationMeta({ page, perPage, total });
    if (total === 0) {
      return { data: [], meta };
    }
    const offset = (page - 1) * perPage;
    const data = await this.findAll({
      ...queryOptions,
      where,
      whereNodes,
      limit: perPage,
      offset,
    });

    return {
      data,
      meta,
    };
  }

  async chunk(
    count: number,
    callback: (rows: TEntity[]) => Promise<boolean | void>,
    options: Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset"> = {},
  ): Promise<void> {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("Chunk size must be a positive integer.");
    }

    if (this.primaryKeySeekDirection(options) === "asc") {
      const seekOptions = { ...options };
      delete seekOptions.orderBy;
      await this.chunkById(
        count,
        async (rows) => ((await callback(rows)) === false ? false : undefined),
        seekOptions,
      );
      return;
    }

    let offset = 0;

    while (true) {
      const rows = await this.findAll({
        ...options,
        limit: count,
        offset,
      });

      if (rows.length === 0) {
        return;
      }

      const shouldContinue = await callback(rows);

      if (shouldContinue === false || rows.length < count) {
        return;
      }

      offset += count;
    }
  }

  async chunkById(
    count: number,
    callback: (rows: TEntity[]) => Promise<boolean | undefined>,
    options: Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset" | "orderBy"> = {},
  ): Promise<void> {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("Chunk size must be a positive integer.");
    }

    let cursor: TEntity[PrimaryKey] | undefined;

    while (true) {
      const { data, meta } = await this.cursorPaginate({
        ...options,
        perPage: count,
        ...(cursor === undefined ? {} : { cursor }),
      });

      if (data.length === 0) {
        return;
      }

      if ((await callback(data)) === false) {
        return;
      }

      if (!meta.has_more || meta.next_cursor === null) {
        return;
      }

      cursor = meta.next_cursor;
    }
  }

  async cursorPaginate(
    options: {
      perPage: number;
      cursor?: TEntity[PrimaryKey];
      cursorColumn?: PrimaryKey;
      direction?: "asc" | "desc";
    } & Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset">,
  ): Promise<CursorPaginatedResult<TEntity, TEntity[PrimaryKey]>> {
    const {
      perPage,
      cursor,
      cursorColumn = this.table.primaryKey,
      direction = "asc",
      where = {},
      whereNodes,
      ...queryOptions
    } = options;

    if (!Number.isInteger(perPage) || perPage <= 0) {
      throw new Error("Cursor page size must be a positive integer.");
    }

    const filters: WhereNode<TEntity>[] = [];
    if (Object.keys(where).length > 0) filters.push({ kind: "and", where });
    filters.push(...(whereNodes ?? []));
    const cursorFilters: WhereNode<TEntity>[] = [{ kind: "and", group: filters }];
    if (cursor !== undefined) {
      const cursorWhere: QueryWhere<TEntity> = {};
      (cursorWhere as Record<string, unknown>)[cursorColumn] =
        direction === "asc" ? { gt: cursor } : { lt: cursor };
      cursorFilters.push({ kind: "and", where: cursorWhere });
    }

    const rows = await this.findAll({
      ...queryOptions,
      where: {},
      whereNodes: cursorFilters,
      orderBy: { [cursorColumn]: direction } as QueryOptions<TEntity>["orderBy"],
      limit: perPage + 1,
    });

    const hasMore = rows.length > perPage;
    const data = hasMore ? rows.slice(0, perPage) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.[cursorColumn] ?? null) : null;
    const prevCursor = cursor ?? null;

    return {
      data,
      meta: {
        per_page: perPage,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        has_more: hasMore,
      },
    };
  }

  async keysetPaginate(
    options: KeysetOptions<TEntity> &
      Omit<ExtendedQueryOptions<TEntity>, "orderBy" | "limit" | "offset">,
  ): Promise<CursorPaginatedResult<TEntity, KeysetCursor>> {
    const order = validateKeyset(this.table, options);
    if (
      options.joins?.length ||
      options.groupBy ||
      options.having ||
      "offset" in options ||
      "limit" in options
    )
      throw new TypeError(
        "Keyset pagination does not accept joined/grouped/offset/limited queries.",
      );
    if (options.select?.some((item) => item.as?.toLowerCase().startsWith(KEYSET_ALIAS_PREFIX)))
      throw new TypeError("Projection conflicts with reserved keyset aliases.");
    const filters: WhereNode<TEntity>[] = [...(options.whereNodes ?? [])];
    if (options.where) filters.push({ kind: "and", where: options.where });
    const rows = await this.findAll({
      ...options,
      where: {},
      whereNodes: [
        { kind: "and", group: filters },
        ...keysetBoundary<TEntity>(order, options.cursor),
      ],
      orderBy: order as QueryOptions<TEntity>["orderBy"],
      limit: options.perPage + 1,
      select: [
        ...(options.select?.length
          ? options.select
          : this.table.columns.map((column) => ({
              kind: "column" as const,
              table: this.table.name,
              column,
            }))),
        ...order.map((item, i) => ({
          kind: "textColumn" as const,
          table: this.table.name,
          column: item.column,
          as: `${KEYSET_ALIAS_PREFIX}${i}`,
        })),
      ],
    });

    const entries = rows.map((row) => {
      const record = { ...row } as Record<string, unknown>;
      const values = order.map((_, i) => {
        const key = `${KEYSET_ALIAS_PREFIX}${i}`;
        const value = record[key];
        delete record[key];
        if (typeof value !== "string" || value.length > 4096)
          throw new TypeError("Keyset columns must contain non-null bounded scalar values.");
        return value;
      });
      return { record: record as TEntity, values };
    });
    const hasMore = entries.length > options.perPage;
    const visible = entries.slice(0, options.perPage);
    const last = visible.at(-1);
    const nextCursor: KeysetCursor | null =
      hasMore && last ? { version: 1, order, values: last.values } : null;
    const data = visible.map(({ record }) => record);
    return {
      data,
      meta: {
        per_page: options.perPage,
        has_more: hasMore,
        next_cursor: nextCursor,
        prev_cursor: options.cursor ?? null,
      },
    };
  }

  async findById(id: TEntity[PrimaryKey]): Promise<TEntity | null> {
    return await this.firstOrNull({
      [this.table.primaryKey]: id,
    } as unknown as QueryWhere<TEntity>);
  }

  async findByIdOrThrow(
    id: TEntity[PrimaryKey],
    errorFactory?: ErrorFactory<TEntity[PrimaryKey]>,
  ): Promise<TEntity> {
    const record = await this.findById(id);

    if (record) {
      return record;
    }

    throw errorFactory?.(id) ?? new Error(`${this.table.name} ${String(id)} was not found.`);
  }

  async findByIds(ids: readonly TEntity[PrimaryKey][]): Promise<TEntity[]> {
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return [];
    }

    return await this.findWhere({
      [this.table.primaryKey]: uniqueIds,
    } as unknown as QueryWhere<TEntity>);
  }

  async firstOrNull(
    where: QueryWhere<TEntity>,
    options: Omit<QueryOptions<TEntity>, "where" | "limit"> = {},
  ): Promise<TEntity | null> {
    const [record] = await this.findAll({ ...options, where, limit: 1 });
    return record ?? null;
  }

  async upsert(
    values: MutationValues<TEntity>,
    conflictColumns: readonly (keyof TEntity & string)[],
    updateColumns?: readonly (keyof TEntity & string)[],
  ): Promise<TEntity | null> {
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(async () => {
          // MySQL uses every unique index, not a named ON CONFLICT target. Require
          // actual conflict values for a deterministic readback when insertId is zero.
          const where: Record<string, unknown> = {};
          for (const column of conflictColumns) {
            if (
              !this.table.columns.includes(column) ||
              values[column] === undefined ||
              values[column] === null
            )
              throw new Error("MySQL upsert requires non-null supplied conflict-column values.");
            where[column] = values[column];
          }
          const query = buildUpsertQuery(this.table, values, conflictColumns, updateColumns);
          const supplied = this.table.columns.filter((column) => values[column] !== undefined);
          const updates =
            updateColumns ?? supplied.filter((column) => !conflictColumns.includes(column));
          const doNothing = !updates.some((column) => supplied.includes(column));
          const existing = doNothing
            ? await repository.firstOrNull(where as QueryWhere<TEntity>, {
                withTrashed: true,
                lock: { mode: "update" },
              })
            : null;
          const [result] = await repository.connection.unsafe<{
            insertId?: number | string;
            affectedRows?: number;
          }>(query.text, query.params);
          repository.mysqlAffected(result);
          if (doNothing && existing) return null;
          const generated = result?.insertId;
          const row =
            generated !== undefined && String(generated) !== "0"
              ? await repository.mysqlRow(generated)
              : await repository.firstOrNull(where as QueryWhere<TEntity>, { withTrashed: true });
          if (!row)
            throw new Error(
              "MySQL upsert could not resolve the persisted row; transaction rolled back.",
            );
          return row;
        }),
      );
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildUpsertQuery(this.table, values, conflictColumns, updateColumns);
      const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      );

      return (record as TEntity | undefined) ?? null;
    });
  }

  async incrementById(
    id: TEntity[PrimaryKey],
    column: keyof TEntity & string,
    amount = 1,
    extra: UpdateValues<TEntity, PrimaryKey> = {} as UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(() =>
          repository.mysqlWriteById(
            buildIncrementQuery(this.table, id, column, amount, extra),
            id,
            false,
            true,
          ),
        ),
      );
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildIncrementQuery(this.table, id, column, amount, extra);
      const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      );

      return (record as TEntity | undefined) ?? null;
    });
  }

  async decrementById(
    id: TEntity[PrimaryKey],
    column: keyof TEntity & string,
    amount = 1,
    extra: UpdateValues<TEntity, PrimaryKey> = {} as UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    return await this.incrementById(id, column, -amount, extra);
  }

  async create(values: MutationValues<TEntity>): Promise<TEntity> {
    this.assertTransactionalEvent("created");
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(async () => {
          const query = buildInsertQuery(this.table, values);
          const [result] = await repository.connection.unsafe<{
            insertId?: number | string;
            affectedRows?: number;
          }>(query.text, query.params);
          repository.mysqlAffected(result);
          const key =
            String(result?.insertId ?? "0") !== "0"
              ? result?.insertId
              : values[this.table.primaryKey];
          const row = await repository.mysqlRow(key);
          if (!row) throw new Error(`Insert into ${this.table.name} did not return a record.`);
          await dispatchModelEvent(modelEventName(this.table.name, "created"), row);
          return row;
        }),
      );
    return await this.runModelMutation("created", () =>
      withDatabaseErrorHandling(async () => {
        const { text, params } = buildInsertQuery(this.table, values);
        const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
          text,
          params,
        );

        if (!record) {
          throw new Error(`Insert into ${this.table.name} did not return a record.`);
        }

        const entity = record as TEntity;
        await dispatchModelEvent(modelEventName(this.table.name, "created"), entity);
        return entity;
      }),
    );
  }

  /** Set-based writes intentionally bypass per-row model observers and write casts. */
  async updateWhere(
    changes: UpdateValues<TEntity, PrimaryKey>,
    options: QueryOptions<TEntity>,
  ): Promise<number> {
    return this.executeConditionalWrite("update", changes, options);
  }

  async deleteWhere(options: QueryOptions<TEntity>): Promise<number> {
    return this.executeConditionalWrite("delete", {}, options);
  }

  async updateWhereReturning<K extends keyof TEntity & string>(
    changes: UpdateValues<TEntity, PrimaryKey>,
    columns: readonly K[],
    options: QueryOptions<TEntity>,
  ): Promise<Pick<TEntity, K>[]> {
    const { text, params } = buildConditionalWriteQuery(
      this.table,
      "update",
      changes,
      options,
      columns,
    );
    return withDatabaseErrorHandling(() => this.connection.unsafe<Pick<TEntity, K>>(text, params));
  }

  private async executeConditionalWrite(
    operation: "update" | "delete",
    changes: UpdateValues<TEntity, PrimaryKey>,
    options: QueryOptions<TEntity>,
  ): Promise<number> {
    const { text, params } = buildConditionalWriteQuery(this.table, operation, changes, options);
    return withDatabaseErrorHandling(async () => {
      const rows = await this.connection.unsafe<{ affectedRows?: number }>(text, params);
      if (currentSqlDialect().driver !== "mysql") return rows.length;
      const affected = rows[0]?.affectedRows;
      if (!Number.isSafeInteger(affected) || affected === undefined || affected < 0)
        throw new Error(
          "MySQL conditional writes require affectedRows metadata from the framework adapter.",
        );
      return affected;
    });
  }

  async updateById(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    this.assertTransactionalEvent("updated");
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(async () => {
          const row = await repository.mysqlWriteById(
            buildUpdateQuery(this.table, id, changes),
            id,
            false,
            true,
          );
          if (row) await dispatchModelEvent(modelEventName(this.table.name, "updated"), row);
          return row;
        }),
      );
    return await this.runModelMutation("updated", () =>
      withDatabaseErrorHandling(async () => {
        const { text, params } = buildUpdateQuery(this.table, id, changes);
        const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
          text,
          params,
        );

        const entity = (record as TEntity | undefined) ?? null;

        if (entity) {
          await dispatchModelEvent(modelEventName(this.table.name, "updated"), entity);
        }

        return entity;
      }),
    );
  }

  async updateByIdOrThrow(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
    errorFactory?: ErrorFactory<TEntity[PrimaryKey]>,
  ): Promise<TEntity> {
    const record = await this.updateById(id, changes);

    if (record) {
      return record;
    }

    throw errorFactory?.(id) ?? new Error(`${this.table.name} ${String(id)} was not found.`);
  }

  async deleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    if (resolveSoftDeleteColumn(this.table)) {
      return await this.softDeleteById(id);
    }

    return await this.forceDeleteById(id);
  }

  async softDeleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    this.assertTransactionalEvent("deleted");
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(async () => {
          const row = await repository.mysqlWriteById(
            buildSoftDeleteByIdQuery(this.table, id, new Date()),
            id,
            true,
          );
          if (!row) return false;
          await dispatchModelEvent(modelEventName(this.table.name, "deleted"), row);
          return true;
        }),
      );
    return await this.runModelMutation("deleted", () =>
      withDatabaseErrorHandling(async () => {
        const { text, params } = buildSoftDeleteByIdQuery(this.table, id, new Date());
        const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
          text,
          params,
        );

        if (!record) {
          return false;
        }

        await dispatchModelEvent(modelEventName(this.table.name, "deleted"), record as TEntity);
        return true;
      }),
    );
  }

  async forceDeleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    this.assertTransactionalEvent("force-deleted");
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(async () => {
          const query = buildDeleteByIdQuery(this.table, id);
          const [result] = await repository.connection.unsafe<{ affectedRows?: number }>(
            query.text,
            query.params,
          );
          if (!repository.mysqlAffected(result)) return false;
          await dispatchModelEvent(modelEventName(this.table.name, "force-deleted"), { id });
          return true;
        }),
      );
    return await this.runModelMutation("force-deleted", () =>
      withDatabaseErrorHandling(async () => {
        const { text, params } = buildDeleteByIdQuery(this.table, id);
        const [row] = await this.connection.unsafe<DeletedRow>(text, params);

        if (!row) {
          return false;
        }

        await dispatchModelEvent(modelEventName(this.table.name, "force-deleted"), {
          id,
        });
        return true;
      }),
    );
  }

  async restoreById(id: TEntity[PrimaryKey]): Promise<TEntity | null> {
    this.assertTransactionalEvent("restored");
    if (currentSqlDialect().driver === "mysql")
      return this.mysqlMutation((repository) =>
        withDatabaseErrorHandling(async () => {
          const row = await repository.mysqlWriteById(buildRestoreByIdQuery(this.table, id), id);
          if (row) await dispatchModelEvent(modelEventName(this.table.name, "restored"), row);
          return row;
        }),
      );
    return await this.runModelMutation("restored", () =>
      withDatabaseErrorHandling(async () => {
        const { text, params } = buildRestoreByIdQuery(this.table, id);
        const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
          text,
          params,
        );

        if (!record) {
          return null;
        }

        const entity = record as TEntity;
        await dispatchModelEvent(modelEventName(this.table.name, "restored"), entity);
        return entity;
      }),
    );
  }

  private primaryKeySeekDirection(options: ExtendedQueryOptions<TEntity>): "asc" | "desc" | null {
    if (
      options.joins?.length ||
      options.groupBy ||
      options.having ||
      options.select?.length ||
      options.offset !== undefined ||
      options.limit !== undefined ||
      options.lock
    ) {
      return null;
    }

    const orders = listOrders(options.orderBy ?? this.table.defaultOrderBy);
    const order = orders[0];
    if (orders.length !== 1 || !order || order.nulls || order.column !== this.table.primaryKey) {
      return null;
    }

    return order.direction;
  }

  withConnection(connection: DatabaseConnection): this {
    return this.cloneWithConnection(connection);
  }

  /** Override when constructor initialization or native private fields must be preserved. */
  protected cloneWithConnection(connection: DatabaseConnection): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(clone, this);
    (clone as unknown as { connection: DatabaseConnection }).connection = connection;
    return clone;
  }

  getConnection(): DatabaseConnection {
    return this.connection;
  }

  getTable(): TableDefinition<TEntity, PrimaryKey> {
    return this.table;
  }

  query(where: QueryWhere<TEntity> = {}): RepositoryQuery<TEntity, PrimaryKey> {
    return new RepositoryQuery(this, where);
  }

  protected async findWhere(
    where: QueryWhere<TEntity>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<TEntity[]> {
    return await this.findAll({ ...options, where });
  }

  protected async countWhere(
    where: QueryWhere<TEntity> = {},
    options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed" | "joins" | "groupBy"> = {},
    whereNodes: readonly WhereNode<TEntity>[] = [],
  ): Promise<number> {
    const { text, params } = buildCountQuery(this.table, where, options, whereNodes);
    const [row] = await this.connection.unsafe<CountRow>(text, params);
    return Number(row?.count ?? 0);
  }

  protected async averageColumn(
    column: keyof TEntity & string,
    where: QueryWhere<TEntity> = {},
  ): Promise<number> {
    const qualifiedColumn = qualifyColumn(this.table.name, column);
    return await this.averageExpression(`AVG(${qualifiedColumn})`, "value", where);
  }

  protected async averageExpression(
    expression: string,
    alias: string,
    where: QueryWhere<TEntity> = {},
  ): Promise<number> {
    const { text, params } = buildProjectionQuery(this.table, expression, alias, { where });
    const [row] = await this.connection.unsafe<Record<string, number | string | null>>(
      text,
      params,
    );

    return Number(row?.[alias] ?? 0);
  }

  /** One plain grouped projection; SQL numeric totals remain exact text, never implicit JS numbers. */
  async sumBy<K extends keyof TEntity & string>(
    groupColumn: K,
    column: keyof TEntity & string,
    options: ExtendedQueryOptions<TEntity> = {},
  ): Promise<Array<{ value: TEntity[K] | null; sum: string | null }>> {
    const { whereNodes, ...queryOptions } = options;
    const { text, params } = buildGroupedSumQuery(
      this.table,
      groupColumn,
      column,
      queryOptions,
      whereNodes ?? [],
    );
    return withDatabaseErrorHandling(() =>
      this.connection.unsafe<{ value: TEntity[K] | null; sum: string | null }>(text, params),
    );
  }

  async sum(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return await this.aggregateColumn("SUM", column, where);
  }

  async avg(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return await this.aggregateColumn("AVG", column, where);
  }

  async min(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return await this.aggregateColumn("MIN", column, where);
  }

  async max(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return await this.aggregateColumn("MAX", column, where);
  }

  private async aggregateColumn(
    fn: "SUM" | "AVG" | "MIN" | "MAX",
    column: keyof TEntity & string,
    where: QueryWhere<TEntity>,
  ): Promise<number> {
    const qualifiedColumn = qualifyColumn(this.table.name, column);
    return await this.averageExpression(`${fn}(${qualifiedColumn})`, "value", where);
  }

  protected async pluckNumberValues(
    expression: string,
    alias: string,
    options: QueryOptions<TEntity> = {},
  ): Promise<number[]> {
    const { text, params } = buildProjectionQuery(this.table, expression, alias, options);
    const rows = await this.connection.unsafe<Record<string, number | string | null>>(text, params);

    return rows.flatMap((row) => {
      const value = row[alias];
      return value === null || value === undefined ? [] : [Number(value)];
    });
  }

  protected async countGroupedBy<K extends keyof TEntity & string>(
    column: K,
    where: QueryWhere<TEntity> = {},
  ): Promise<Array<{ value: TEntity[K] | null; count: number }>> {
    const { text, params } = buildGroupedCountQuery(this.table, column, where);
    const rows = await this.connection.unsafe<ValueCountRow<TEntity[K]>>(text, params);

    return rows.map(({ value, count }) => ({
      value,
      count: Number(count),
    }));
  }

  async findByHasManyRelation<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    ForeignKey extends keyof TEntity & string,
  >(
    relation: HasManyRelation<TParent, TEntity, LocalKey, ForeignKey>,
    parentId: TParent[LocalKey],
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<TEntity[]> {
    return await this.findWhere(
      {
        [relation.foreignKey]: parentId,
      } as unknown as QueryWhere<TEntity>,
      options,
    );
  }

  async loadHasManyForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    ForeignKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: HasManyRelation<TParent, TEntity, LocalKey, ForeignKey>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<Map<TParent[LocalKey], TEntity[]>> {
    if (parents.length === 0) {
      return indexHasManyRelation(parents, [], relation);
    }

    const parentIds = [...new Set(parents.map((parent) => parent[relation.localKey]))];
    const where = { [relation.foreignKey]: parentIds } as unknown as QueryWhere<TEntity>;
    const children = await this.findRelationRows(where, options, relation.foreignKey);

    return indexHasManyRelation(parents, children, relation);
  }

  async findHasManyThrough<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    FirstKey extends string,
    SecondLocalKey extends string,
    SecondKey extends keyof TEntity & string,
  >(
    parentId: unknown,
    relation: HasManyThroughRelation<
      TParent,
      TEntity,
      LocalKey,
      FirstKey,
      SecondLocalKey,
      SecondKey
    >,
    options: QueryOptions<TEntity> = {},
  ): Promise<TEntity[]> {
    const grouped = await this.loadHasManyThroughForParents(
      [{ [relation.localKey]: parentId } as TParent],
      relation,
      options,
    );
    return getByRelationKey(grouped, parentId) ?? [];
  }

  async loadHasManyThroughForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    FirstKey extends string,
    SecondLocalKey extends string,
    SecondKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: HasManyThroughRelation<
      TParent,
      TEntity,
      LocalKey,
      FirstKey,
      SecondLocalKey,
      SecondKey
    >,
    options: QueryOptions<TEntity> = {},
  ): Promise<Map<TParent[LocalKey], TEntity[]>> {
    if (parents.length === 0) {
      return indexHasManyThroughRelation(parents, [], relation);
    }

    if (options.joins?.some((join) => join.table === relation.throughTable)) {
      throw new Error(
        "A related model scope joins the through table twice; use an explicitly aliased correlated predicate instead.",
      );
    }
    const parentIds = [...new Set(parents.map((parent) => parent[relation.localKey]))];
    const { text, params } = buildHasManyThroughQuery(this.table, relation, parentIds, options);
    const children = await this.connection.unsafe<TEntity & Record<string, unknown>>(text, params);
    for (const child of children) delete child[EAGER_ROW_NUMBER];

    return indexHasManyThroughRelation(parents, children, relation);
  }

  async loadBelongsToForParents<
    TChild extends object,
    TParent extends object,
    ForeignKey extends keyof TChild & string,
    OwnerKey extends keyof TParent & string,
  >(
    children: readonly TChild[],
    relation: BelongsToRelation<TChild, TParent, ForeignKey, OwnerKey>,
    parentRepository: BaseRepository<TParent, OwnerKey>,
    options: Omit<QueryOptions<TParent>, "where"> = {},
  ): Promise<Map<TChild[ForeignKey], TParent>> {
    if (children.length === 0) {
      return new Map();
    }

    const ownerIds = [...new Set(children.map((child) => child[relation.foreignKey]))];
    const parents = await parentRepository.withConnection(this.connection).findWhere(
      {
        [relation.ownerKey]: ownerIds,
      } as unknown as QueryWhere<TParent>,
      options,
    );

    return indexBelongsToRelation(children, parents, relation);
  }

  async loadMorphManyForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    MorphTypeKey extends keyof TEntity & string,
    MorphIdKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: MorphManyRelation<TParent, TEntity, LocalKey, MorphTypeKey, MorphIdKey>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<Map<TParent[LocalKey], TEntity[]>> {
    if (parents.length === 0) {
      return indexMorphManyRelation(parents, [], relation);
    }

    const parentIds = [...new Set(parents.map((parent) => parent[relation.localKey]))];
    const children = await this.findRelationRows(
      {
        [relation.morphTypeKey]: relation.morphType,
        [relation.morphIdKey]: parentIds,
      } as unknown as QueryWhere<TEntity>,
      options,
      relation.morphIdKey,
    );

    return indexMorphManyRelation(parents, children, relation);
  }

  private async findRelationRows(
    where: QueryWhere<TEntity>,
    options: Omit<QueryOptions<TEntity>, "where">,
    foreignKey: string,
  ): Promise<TEntity[]> {
    if (options.limit === undefined && options.offset === undefined)
      return this.findWhere(where, options);
    const bounded: RelationWindowOptions<TEntity> = {
      ...options,
      [RELATION_WINDOW]: { table: this.table.name, column: foreignKey },
    };
    // Keep protected findWhere/findAll overrides in the dispatch path.
    return this.findWhere(where, bounded);
  }

  async loadMorphOneForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    MorphTypeKey extends keyof TEntity & string,
    MorphIdKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: MorphOneRelation<TParent, TEntity, LocalKey, MorphTypeKey, MorphIdKey>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<Map<TParent[LocalKey], TEntity | undefined>> {
    const grouped = await this.loadMorphManyForParents(
      parents,
      relation as unknown as MorphManyRelation<
        TParent,
        TEntity,
        LocalKey,
        MorphTypeKey,
        MorphIdKey
      >,
      options,
    );
    const result = new Map<TParent[LocalKey], TEntity | undefined>();

    for (const parent of parents) {
      const matches = getByRelationKey(grouped, parent[relation.localKey]) ?? [];
      result.set(parent[relation.localKey], matches[0]);
    }

    return result;
  }

  async loadMorphToForChildren<
    TChild extends object,
    TParent extends object,
    MorphTypeKey extends keyof TChild & string,
    MorphIdKey extends keyof TChild & string,
    OwnerKey extends keyof TParent & string,
  >(
    children: readonly TChild[],
    relation: MorphToRelation<TChild, MorphTypeKey, MorphIdKey>,
    repositoriesByType: ReadonlyMap<string, BaseRepository<TParent, OwnerKey>>,
    options: Omit<QueryOptions<TParent>, "where"> = {},
  ): Promise<Map<TChild[MorphIdKey], TParent>> {
    if (children.length === 0) {
      return new Map();
    }

    const idsByType = new Map<string, Set<TParent[OwnerKey]>>();

    for (const child of children) {
      const morphType = String(child[relation.morphTypeKey]);
      const morphId = child[relation.morphIdKey] as unknown as TParent[OwnerKey];
      const ids = idsByType.get(morphType) ?? new Set<TParent[OwnerKey]>();
      ids.add(morphId);
      idsByType.set(morphType, ids);
    }

    const parentsByType = new Map<string, Map<string, TParent>>();

    await Promise.all(
      [...idsByType.entries()].map(async ([morphType, ids]) => {
        const repository = repositoriesByType.get(morphType);

        if (!repository) {
          return;
        }

        const ownerKey = repository.getTable().primaryKey as OwnerKey;
        const parents = await repository.withConnection(this.connection).findWhere(
          {
            [ownerKey]: [...ids],
          } as unknown as QueryWhere<TParent>,
          options,
        );
        const indexed = new Map<string, TParent>();

        for (const parent of parents) {
          indexed.set(relationMatchKey(parent[ownerKey]), parent);
        }

        parentsByType.set(morphType, indexed);
      }),
    );

    return indexMorphToRelation(children, parentsByType, relation);
  }

  async loadBelongsToManyForParents<
    TParent extends object,
    TRelated extends object,
    Pivot extends object,
    ParentKey extends keyof TParent & string,
    RelatedKey extends keyof TRelated & string,
    ForeignPivotKey extends keyof Pivot & string,
    RelatedPivotKey extends keyof Pivot & string,
  >(
    parents: readonly TParent[],
    relation: BelongsToManyRelation<
      TParent,
      TRelated,
      Pivot,
      ParentKey,
      RelatedKey,
      ForeignPivotKey,
      RelatedPivotKey
    >,
    relatedRepository: BaseRepository<TRelated, RelatedKey>,
    options: Omit<QueryOptions<TRelated>, "where"> = {},
  ): Promise<Map<TParent[ParentKey], TRelated[]>> {
    if (parents.length === 0) {
      return indexBelongsToManyRelation(parents, [], [], relation);
    }

    const parentIds = [...new Set(parents.map((parent) => parent[relation.parentKey]))];
    const { text, params } = buildPivotLookupQuery(relation, parentIds);
    const pivotRows = await this.connection.unsafe<Pivot>(text, params);

    if (pivotRows.length === 0) {
      return indexBelongsToManyRelation(parents, [], [], relation);
    }

    const relatedIds = [
      ...new Set(
        pivotRows.map((row) => row[relation.relatedPivotKey] as unknown as TRelated[RelatedKey]),
      ),
    ];
    const limited = options.limit !== undefined || options.offset !== undefined;
    const ownerAlias = "__strata_pivot_parent_id";
    const bounded: RelationWindowOptions<TRelated> = limited
      ? {
          ...options,
          joins: [
            ...(options.joins ?? []),
            {
              type: "inner",
              table: relation.pivotTable,
              on: [
                {
                  left: { table: relatedRepository.table.name, column: relation.relatedKey },
                  right: { table: relation.pivotTable, column: relation.relatedPivotKey },
                },
              ],
            },
          ],
          whereNodes: [
            ...(options.whereNodes ?? []),
            {
              kind: "and",
              where: {
                [`${relation.pivotTable}.${relation.foreignPivotKey}`]: parentIds,
              } as unknown as QueryWhere<TRelated>,
            },
          ],
          [RELATION_WINDOW]: {
            table: relation.pivotTable,
            column: relation.foreignPivotKey,
            ownerAlias,
          },
        }
      : options;
    const relatedRows = await relatedRepository.withConnection(this.connection).findWhere(
      {
        [relation.relatedKey]: relatedIds,
      } as unknown as QueryWhere<TRelated>,
      bounded,
    );

    if (limited) {
      return indexHasManyThroughRelation(
        parents,
        relatedRows as Array<TRelated & Record<string, unknown>>,
        {
          type: "hasManyThrough",
          name: relation.name,
          localKey: relation.parentKey,
          throughTable: relation.pivotTable,
          firstKey: relation.foreignPivotKey,
          secondLocalKey: relation.relatedPivotKey,
          secondKey: relation.relatedKey,
          throughParentKey: ownerAlias,
        },
      );
    }

    return indexBelongsToManyRelation(parents, pivotRows, relatedRows, relation);
  }
}

export { BaseRepository };
export default BaseRepository;
export type { DatabaseConnection, SqlDatabaseConnection };
