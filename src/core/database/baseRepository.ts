import type {
  RepositoryAction,
  RepositoryBinding,
  RepositoryDefinition,
} from "@getstrata/core/database/definitions";
import { withDatabaseErrorHandling } from "@getstrata/core/database/errors";
import { getBindingPorts } from "#strata-orm-internal";
import type { KeysetCursor, KeysetOptions } from "../pagination/index.ts";
import {
  buildPaginationMeta,
  type CursorPaginatedResult,
  type PaginatedResult,
} from "../pagination/index.ts";
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
import { snapshotQueryPlan } from "./queryPlanSnapshot";
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
import { RepositoryQuery } from "./repositoryQuery.ts";
import type { SqlDialect } from "./sqlDialects";
import type { TableDefinition } from "./table.ts";
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
const RELATED_REPOSITORY = Symbol("relatedRepositoryDefinition");
type RelationWindowOptions<TEntity extends object> = ExtendedQueryOptions<TEntity> & {
  [RELATION_WINDOW]?: { table: string; column: string; ownerAlias?: string };
};

let getRepositoryBinding: <R extends object, K extends keyof R & string>(
  repository: BaseRepository<R, K>,
) => RepositoryBinding<R, K>;

class BaseRepository<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  readonly #binding: RepositoryBinding<TEntity, PrimaryKey>;
  protected readonly table: TableDefinition<TEntity, PrimaryKey>;

  constructor(binding: RepositoryBinding<TEntity, PrimaryKey>) {
    getBindingPorts(binding).assertActive();
    this.#binding = binding;
    this.table = binding.table;
  }

  static {
    getRepositoryBinding = <R extends object, K extends keyof R & string>(
      repository: BaseRepository<R, K>,
    ): RepositoryBinding<R, K> => repository.#binding;
  }

  private get connection() {
    const session = this.#binding.session;
    return {
      unsafe: <R>(text: string, params: readonly unknown[] = []): Promise<R[]> =>
        session.execute<R>({ text, params }).then((rows) => [...rows]),
    };
  }

  private assertTransactionalEvent(action: RepositoryAction): void {
    getBindingPorts(this.#binding).assertMutation(action);
  }

  private runModelMutation<T>(
    action: RepositoryAction,
    operation: (repository: this) => Promise<T>,
  ): Promise<T> {
    return getBindingPorts(this.#binding).mutation(action, (repository) =>
      operation(repository as this),
    );
  }

  private mysqlMutation<T>(operation: (repository: this) => Promise<T>): Promise<T> {
    return this.#binding.session.transaction((session) =>
      operation(getBindingPorts(this.#binding).reselect<this>(session)),
    );
  }

  private publish(action: RepositoryAction, row: Readonly<TEntity>): Promise<void> {
    return getBindingPorts(this.#binding).publish(action, row);
  }

  private transformWrite(
    action: RepositoryAction,
    values: Partial<TEntity>,
  ): Promise<Partial<TEntity>> {
    const hook = getBindingPorts(this.#binding).hooks?.transformWrite;
    return Promise.resolve(
      hook ? hook(action, snapshotQueryPlan(values), this.#binding) : values,
    ).then((output) => snapshotQueryPlan(output));
  }

  private transformQuery(options: ExtendedQueryOptions<TEntity>): ExtendedQueryOptions<TEntity> {
    const hook = getBindingPorts(this.#binding).hooks?.transformQuery;
    return snapshotQueryPlan(hook ? hook(options, this.#binding) : options);
  }

  private hydrateRow(row: TEntity): TEntity {
    const hook = getBindingPorts(this.#binding).hooks?.hydrateRow;
    return hook ? snapshotQueryPlan(hook(snapshotQueryPlan(row), this.#binding)) : row;
  }

  private relatedRepository<R extends object, K extends keyof R & string>(
    repository: BaseRepository<R, K>,
  ): BaseRepository<R, K> {
    const owner = getBindingPorts(this.#binding);
    const related = getBindingPorts(getRepositoryBinding(repository));
    related.assertActive();
    if (owner.app !== related.app || owner.pool !== related.pool || owner.branch !== related.branch)
      throw new TypeError("Related repositories must belong to the exact same live session.");
    return owner.repository(
      related.definition as unknown as RepositoryDefinition<R, K, BaseRepository<R, K>>,
    );
  }

  private runTerminal<A extends unknown[], V>(
    args: A,
    work: (...args: A) => V | Promise<V>,
  ): Promise<V> {
    let plan: A;
    try {
      getBindingPorts(this.#binding).assertActive();
      plan = snapshotQueryPlan(args, new Map(), (value) => {
        if (!(value instanceof BaseRepository)) return value;
        const related = this.relatedRepository(value);
        return { [RELATED_REPOSITORY]: getBindingPorts(getRepositoryBinding(related)).definition };
      });
    } catch (error) {
      return this.#binding.run(() => {
        throw error;
      });
    }
    return this.#binding.run(() => {
      const args = snapshotQueryPlan(plan, new Map(), (value) => {
        const definition = Object.getOwnPropertyDescriptor(value, RELATED_REPOSITORY)?.value;
        return definition ? getBindingPorts(this.#binding).repository(definition) : value;
      });
      return work(...args);
    });
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

  count(options: ExtendedQueryOptions<TEntity> = {}): Promise<number> {
    return this.runTerminal([options] as [typeof options], async (options) => {
      if (options.lock) throw new Error("Row locks require a row selection, not count().");
      const { whereNodes, where, ...rest } = options;
      return await this.countWhere(where ?? {}, rest, whereNodes ?? []);
    });
  }

  findAll(options: ExtendedQueryOptions<TEntity> = {}): Promise<TEntity[]> {
    return this.runTerminal([options] as [typeof options], async (options) => {
      options = this.transformQuery(options);
      return await withDatabaseErrorHandling(async () => {
        if (options.lock && !("requestRollback" in this.#binding.session)) {
          throw new Error("Row locks require an explicit transaction session.");
        }
        const {
          whereNodes,
          [RELATION_WINDOW]: relationWindow,
          ...queryOptions
        } = options as RelationWindowOptions<TEntity>;
        const dialect = this.#binding.dialect;
        const { text, params } = relationWindow
          ? buildLimitedHasManyQuery(
              dialect,
              this.table,
              { ...queryOptions, whereNodes },
              relationWindow,
            )
          : buildSelectQuery(dialect, this.table, queryOptions, whereNodes ?? []);
        const rows = await this.connection.unsafe<TEntity & Record<string, unknown>>(text, params);
        if (relationWindow) for (const row of rows) delete row[EAGER_ROW_NUMBER];
        return rows.map((row) => this.hydrateRow(row));
      });
    });
  }

  paginate(
    options: {
      page: number;
      perPage: number;
    } & Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset">,
  ): Promise<PaginatedResult<TEntity>> {
    return this.runTerminal([options] as [typeof options], async (options) => {
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
    });
  }

  chunk(
    count: number,
    callback: (rows: TEntity[]) => Promise<boolean | void>,
    options: Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset"> = {},
  ): Promise<void> {
    return this.runTerminal(
      [count, callback, options] as [typeof count, typeof callback, typeof options],
      async (count, callback, options) => {
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
      },
    );
  }

  chunkById(
    count: number,
    callback: (rows: TEntity[]) => Promise<boolean | undefined>,
    options: Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset" | "orderBy"> = {},
  ): Promise<void> {
    return this.runTerminal(
      [count, callback, options] as [typeof count, typeof callback, typeof options],
      async (count, callback, options) => {
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
      },
    );
  }

  cursorPaginate(
    options: {
      perPage: number;
      cursor?: TEntity[PrimaryKey];
      cursorColumn?: PrimaryKey;
      direction?: "asc" | "desc";
    } & Omit<ExtendedQueryOptions<TEntity>, "limit" | "offset">,
  ): Promise<CursorPaginatedResult<TEntity, TEntity[PrimaryKey]>> {
    return this.runTerminal([options] as [typeof options], async (options) => {
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
        orderBy: {
          [cursorColumn]: direction,
        } as QueryOptions<TEntity>["orderBy"],
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
    });
  }

  keysetPaginate(
    options: KeysetOptions<TEntity> &
      Omit<ExtendedQueryOptions<TEntity>, "orderBy" | "limit" | "offset">,
  ): Promise<CursorPaginatedResult<TEntity, KeysetCursor>> {
    return this.runTerminal([options] as [typeof options], async (options) => {
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
          ...keysetBoundary<TEntity>(this.#binding.dialect, order, options.cursor),
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
    });
  }

  findById(id: TEntity[PrimaryKey]): Promise<TEntity | null> {
    return this.runTerminal([id] as [typeof id], async (id) => {
      return await this.firstOrNull({
        [this.table.primaryKey]: id,
      } as unknown as QueryWhere<TEntity>);
    });
  }

  findByIdOrThrow(
    id: TEntity[PrimaryKey],
    errorFactory?: ErrorFactory<TEntity[PrimaryKey]>,
  ): Promise<TEntity> {
    return this.runTerminal(
      [id, errorFactory] as [typeof id, typeof errorFactory],
      async (id, errorFactory) => {
        const record = await this.findById(id);

        if (record) {
          return record;
        }

        throw errorFactory?.(id) ?? new Error(`${this.table.name} ${String(id)} was not found.`);
      },
    );
  }

  findByIds(ids: readonly TEntity[PrimaryKey][]): Promise<TEntity[]> {
    return this.runTerminal([ids] as [typeof ids], async (ids) => {
      const uniqueIds = [...new Set(ids)];

      if (uniqueIds.length === 0) {
        return [];
      }

      return await this.findWhere({
        [this.table.primaryKey]: uniqueIds,
      } as unknown as QueryWhere<TEntity>);
    });
  }

  firstOrNull(
    where: QueryWhere<TEntity>,
    options: Omit<QueryOptions<TEntity>, "where" | "limit"> = {},
  ): Promise<TEntity | null> {
    return this.runTerminal(
      [where, options] as [typeof where, typeof options],
      async (where, options) => {
        const [record] = await this.findAll({ ...options, where, limit: 1 });
        return record ?? null;
      },
    );
  }

  upsert(
    values: MutationValues<TEntity>,
    conflictColumns: readonly (keyof TEntity & string)[],
    updateColumns?: readonly (keyof TEntity & string)[],
  ): Promise<TEntity | null> {
    return this.runTerminal(
      [values, conflictColumns, updateColumns] as [
        typeof values,
        typeof conflictColumns,
        typeof updateColumns,
      ],
      async (values, conflictColumns, updateColumns) => {
        values = await this.transformWrite("created", values);
        const dialect = this.#binding.dialect;
        if (dialect.driver === "mysql")
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
                  throw new Error(
                    "MySQL upsert requires non-null supplied conflict-column values.",
                  );
                where[column] = values[column];
              }
              const query = buildUpsertQuery(
                dialect,
                this.table,
                values,
                conflictColumns,
                updateColumns,
              );
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
                  : await repository.firstOrNull(where as QueryWhere<TEntity>, {
                      withTrashed: true,
                    });
              if (!row)
                throw new Error(
                  "MySQL upsert could not resolve the persisted row; transaction rolled back.",
                );
              return row;
            }),
          );
        return await withDatabaseErrorHandling(async () => {
          const { text, params } = buildUpsertQuery(
            dialect,
            this.table,
            values,
            conflictColumns,
            updateColumns,
          );
          const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
            text,
            params,
          );

          return record === undefined ? null : this.hydrateRow(record as TEntity);
        });
      },
    );
  }

  incrementById(
    id: TEntity[PrimaryKey],
    column: keyof TEntity & string,
    amount = 1,
    extra: UpdateValues<TEntity, PrimaryKey> = {} as UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    return this.runTerminal(
      [id, column, amount, extra] as [typeof id, typeof column, typeof amount, typeof extra],
      async (id, column, amount, extra) => {
        const dialect = this.#binding.dialect;
        if (dialect.driver === "mysql")
          return this.mysqlMutation((repository) =>
            withDatabaseErrorHandling(() =>
              repository.mysqlWriteById(
                buildIncrementQuery(dialect, this.table, id, column, amount, extra),
                id,
                false,
                true,
              ),
            ),
          );
        return await withDatabaseErrorHandling(async () => {
          const { text, params } = buildIncrementQuery(
            dialect,
            this.table,
            id,
            column,
            amount,
            extra,
          );
          const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
            text,
            params,
          );

          return record === undefined ? null : this.hydrateRow(record as TEntity);
        });
      },
    );
  }

  decrementById(
    id: TEntity[PrimaryKey],
    column: keyof TEntity & string,
    amount = 1,
    extra: UpdateValues<TEntity, PrimaryKey> = {} as UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    return this.runTerminal(
      [id, column, amount, extra] as [typeof id, typeof column, typeof amount, typeof extra],
      async (id, column, amount, extra) => {
        return await this.incrementById(id, column, -amount, extra);
      },
    );
  }

  create(values: MutationValues<TEntity>): Promise<TEntity> {
    return this.runTerminal([values] as [typeof values], async (values) => {
      const dialect = this.#binding.dialect;
      this.assertTransactionalEvent("created");
      values = await this.transformWrite("created", values);
      if (dialect.driver === "mysql")
        return this.mysqlMutation((repository) =>
          withDatabaseErrorHandling(async () => {
            const query = buildInsertQuery(dialect, this.table, values);
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
            await repository.publish("created", row);
            return row;
          }),
        );
      return await this.runModelMutation("created", (repository) =>
        withDatabaseErrorHandling(async () => {
          const { text, params } = buildInsertQuery(dialect, this.table, values);
          const [record] = await repository.connection.unsafe<TEntity & Record<string, unknown>>(
            text,
            params,
          );

          if (!record) {
            throw new Error(`Insert into ${this.table.name} did not return a record.`);
          }

          const entity = repository.hydrateRow(record as TEntity);
          await repository.publish("created", entity);
          return entity;
        }),
      );
    });
  }

  /** Set-based writes intentionally bypass per-row model observers and write casts. */
  updateWhere(
    changes: UpdateValues<TEntity, PrimaryKey>,
    options: QueryOptions<TEntity>,
  ): Promise<number> {
    return this.runTerminal(
      [changes, options] as [typeof changes, typeof options],
      async (changes, options) => {
        return this.executeConditionalWrite("update", changes, options);
      },
    );
  }

  deleteWhere(options: QueryOptions<TEntity>): Promise<number> {
    return this.runTerminal([options] as [typeof options], async (options) => {
      return this.executeConditionalWrite("delete", {}, options);
    });
  }

  updateWhereReturning<K extends keyof TEntity & string>(
    changes: UpdateValues<TEntity, PrimaryKey>,
    columns: readonly K[],
    options: QueryOptions<TEntity>,
  ): Promise<Pick<TEntity, K>[]> {
    return this.runTerminal(
      [changes, columns, options] as [typeof changes, typeof columns, typeof options],
      async (changes, columns, options) => {
        const dialect = this.#binding.dialect;
        const { text, params } = buildConditionalWriteQuery(
          dialect,
          this.table,
          "update",
          changes,
          options,
          columns,
        );
        return withDatabaseErrorHandling(() =>
          this.connection.unsafe<Pick<TEntity, K>>(text, params),
        );
      },
    );
  }

  private async executeConditionalWrite(
    operation: "update" | "delete",
    changes: UpdateValues<TEntity, PrimaryKey>,
    options: QueryOptions<TEntity>,
  ): Promise<number> {
    const dialect = this.#binding.dialect;
    const { text, params } = buildConditionalWriteQuery(
      dialect,
      this.table,
      operation,
      changes,
      options,
    );
    return withDatabaseErrorHandling(async () => {
      const rows = await this.connection.unsafe<{ affectedRows?: number }>(text, params);
      if (dialect.driver !== "mysql") return rows.length;
      const affected = rows[0]?.affectedRows;
      if (!Number.isSafeInteger(affected) || affected === undefined || affected < 0)
        throw new Error(
          "MySQL conditional writes require affectedRows metadata from the framework adapter.",
        );
      return affected;
    });
  }

  updateById(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    return this.runTerminal([id, changes] as [typeof id, typeof changes], async (id, changes) => {
      const dialect = this.#binding.dialect;
      this.assertTransactionalEvent("updated");
      changes = await this.transformWrite("updated", changes as Partial<TEntity>);
      if (dialect.driver === "mysql")
        return this.mysqlMutation((repository) =>
          withDatabaseErrorHandling(async () => {
            const row = await repository.mysqlWriteById(
              buildUpdateQuery(dialect, this.table, id, changes),
              id,
              false,
              true,
            );
            if (row) await repository.publish("updated", row);
            return row;
          }),
        );
      return await this.runModelMutation("updated", (repository) =>
        withDatabaseErrorHandling(async () => {
          const { text, params } = buildUpdateQuery(dialect, this.table, id, changes);
          const [record] = await repository.connection.unsafe<TEntity & Record<string, unknown>>(
            text,
            params,
          );

          const entity = record === undefined ? null : repository.hydrateRow(record as TEntity);

          if (entity) {
            await repository.publish("updated", entity);
          }

          return entity;
        }),
      );
    });
  }

  updateByIdOrThrow(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
    errorFactory?: ErrorFactory<TEntity[PrimaryKey]>,
  ): Promise<TEntity> {
    return this.runTerminal(
      [id, changes, errorFactory] as [typeof id, typeof changes, typeof errorFactory],
      async (id, changes, errorFactory) => {
        const record = await this.updateById(id, changes);

        if (record) {
          return record;
        }

        throw errorFactory?.(id) ?? new Error(`${this.table.name} ${String(id)} was not found.`);
      },
    );
  }

  deleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    return this.runTerminal([id] as [typeof id], async (id) => {
      if (resolveSoftDeleteColumn(this.table)) {
        return await this.softDeleteById(id);
      }

      return await this.forceDeleteById(id);
    });
  }

  softDeleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    return this.runTerminal([id] as [typeof id], async (id) => {
      const dialect = this.#binding.dialect;
      this.assertTransactionalEvent("deleted");
      if (dialect.driver === "mysql")
        return this.mysqlMutation((repository) =>
          withDatabaseErrorHandling(async () => {
            const row = await repository.mysqlWriteById(
              buildSoftDeleteByIdQuery(dialect, this.table, id, new Date()),
              id,
              true,
            );
            if (!row) return false;
            await repository.publish("deleted", row);
            return true;
          }),
        );
      return await this.runModelMutation("deleted", (repository) =>
        withDatabaseErrorHandling(async () => {
          const { text, params } = buildSoftDeleteByIdQuery(dialect, this.table, id, new Date());
          const [record] = await repository.connection.unsafe<TEntity & Record<string, unknown>>(
            text,
            params,
          );

          if (!record) {
            return false;
          }

          await repository.publish("deleted", repository.hydrateRow(record as TEntity));
          return true;
        }),
      );
    });
  }

  forceDeleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    return this.runTerminal([id] as [typeof id], async (id) => {
      const dialect = this.#binding.dialect;
      this.assertTransactionalEvent("force-deleted");
      if (dialect.driver === "mysql")
        return this.mysqlMutation((repository) =>
          withDatabaseErrorHandling(async () => {
            const query = buildDeleteByIdQuery(dialect, this.table, id);
            const [result] = await repository.connection.unsafe<{
              affectedRows?: number;
            }>(query.text, query.params);
            if (!repository.mysqlAffected(result)) return false;
            await repository.publish("force-deleted", {
              id,
            } as unknown as TEntity);
            return true;
          }),
        );
      return await this.runModelMutation("force-deleted", (repository) =>
        withDatabaseErrorHandling(async () => {
          const { text, params } = buildDeleteByIdQuery(dialect, this.table, id);
          const [row] = await repository.connection.unsafe<DeletedRow>(text, params);

          if (!row) {
            return false;
          }

          await repository.publish("force-deleted", {
            id,
          } as unknown as TEntity);
          return true;
        }),
      );
    });
  }

  restoreById(id: TEntity[PrimaryKey]): Promise<TEntity | null> {
    return this.runTerminal([id] as [typeof id], async (id) => {
      const dialect = this.#binding.dialect;
      this.assertTransactionalEvent("restored");
      if (dialect.driver === "mysql")
        return this.mysqlMutation((repository) =>
          withDatabaseErrorHandling(async () => {
            const row = await repository.mysqlWriteById(
              buildRestoreByIdQuery(dialect, this.table, id),
              id,
            );
            if (row) await repository.publish("restored", row);
            return row;
          }),
        );
      return await this.runModelMutation("restored", (repository) =>
        withDatabaseErrorHandling(async () => {
          const { text, params } = buildRestoreByIdQuery(dialect, this.table, id);
          const [record] = await repository.connection.unsafe<TEntity & Record<string, unknown>>(
            text,
            params,
          );

          if (!record) {
            return null;
          }

          const entity = repository.hydrateRow(record as TEntity);
          await repository.publish("restored", entity);
          return entity;
        }),
      );
    });
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

  getTable(): TableDefinition<TEntity, PrimaryKey> {
    return this.table;
  }

  query(where: QueryWhere<TEntity> = {}): RepositoryQuery<TEntity, PrimaryKey> {
    return new RepositoryQuery(this, where);
  }

  protected findWhere(
    where: QueryWhere<TEntity>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<TEntity[]> {
    return this.runTerminal(
      [where, options] as [typeof where, typeof options],
      async (where, options) => {
        return await this.findAll({ ...options, where });
      },
    );
  }

  protected countWhere(
    where: QueryWhere<TEntity> = {},
    options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed" | "joins" | "groupBy"> = {},
    whereNodes: readonly WhereNode<TEntity>[] = [],
  ): Promise<number> {
    return this.runTerminal(
      [where, options, whereNodes] as [typeof where, typeof options, typeof whereNodes],
      async (where, options, whereNodes) => {
        const dialect = this.#binding.dialect;
        const plan = this.transformQuery({ ...options, where, whereNodes: [...whereNodes] });
        const { where: filters = {}, whereNodes: nodes = [], ...queryOptions } = plan;
        const { text, params } = buildCountQuery(dialect, this.table, filters, queryOptions, nodes);
        const [row] = await this.connection.unsafe<CountRow>(text, params);
        return Number(row?.count ?? 0);
      },
    );
  }

  protected averageColumn(
    column: keyof TEntity & string,
    where: QueryWhere<TEntity> = {},
  ): Promise<number> {
    return this.runTerminal(
      [column, where] as [typeof column, typeof where],
      async (column, where) => {
        const dialect = this.#binding.dialect;
        const qualifiedColumn = qualifyColumn(dialect, this.table.name, column);
        return await this.averageExpression(`AVG(${qualifiedColumn})`, "value", where, dialect);
      },
    );
  }

  protected averageExpression(
    expression: string,
    alias: string,
    where: QueryWhere<TEntity> = {},
    dialect: SqlDialect = this.#binding.dialect,
  ): Promise<number> {
    return this.runTerminal(
      [expression, alias, where, dialect] as [
        typeof expression,
        typeof alias,
        typeof where,
        typeof dialect,
      ],
      async (expression, alias, where, dialect) => {
        const { text, params } = buildProjectionQuery(
          dialect,
          this.table,
          expression,
          alias,
          this.transformQuery({ where }),
        );
        const [row] = await this.connection.unsafe<Record<string, number | string | null>>(
          text,
          params,
        );

        return Number(row?.[alias] ?? 0);
      },
    );
  }

  /** One plain grouped projection; SQL numeric totals remain exact text, never implicit JS numbers. */
  sumBy<K extends keyof TEntity & string>(
    groupColumn: K,
    column: keyof TEntity & string,
    options: ExtendedQueryOptions<TEntity> = {},
  ): Promise<Array<{ value: TEntity[K] | null; sum: string | null }>> {
    return this.runTerminal(
      [groupColumn, column, options] as [typeof groupColumn, typeof column, typeof options],
      async (groupColumn, column, options) => {
        const dialect = this.#binding.dialect;
        const { whereNodes, ...queryOptions } = this.transformQuery(options);
        const { text, params } = buildGroupedSumQuery(
          dialect,
          this.table,
          groupColumn,
          column,
          queryOptions,
          whereNodes ?? [],
        );
        return withDatabaseErrorHandling(() =>
          this.connection.unsafe<{
            value: TEntity[K] | null;
            sum: string | null;
          }>(text, params),
        );
      },
    );
  }

  sum(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return this.runTerminal(
      [column, where] as [typeof column, typeof where],
      async (column, where) => {
        return await this.aggregateColumn("SUM", column, where);
      },
    );
  }

  avg(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return this.runTerminal(
      [column, where] as [typeof column, typeof where],
      async (column, where) => {
        return await this.aggregateColumn("AVG", column, where);
      },
    );
  }

  min(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return this.runTerminal(
      [column, where] as [typeof column, typeof where],
      async (column, where) => {
        return await this.aggregateColumn("MIN", column, where);
      },
    );
  }

  max(column: keyof TEntity & string, where: QueryWhere<TEntity> = {}): Promise<number> {
    return this.runTerminal(
      [column, where] as [typeof column, typeof where],
      async (column, where) => {
        return await this.aggregateColumn("MAX", column, where);
      },
    );
  }

  private async aggregateColumn(
    fn: "SUM" | "AVG" | "MIN" | "MAX",
    column: keyof TEntity & string,
    where: QueryWhere<TEntity>,
  ): Promise<number> {
    const dialect = this.#binding.dialect;
    const qualifiedColumn = qualifyColumn(dialect, this.table.name, column);
    return await this.averageExpression(`${fn}(${qualifiedColumn})`, "value", where, dialect);
  }

  protected pluckNumberValues(
    expression: string,
    alias: string,
    options: QueryOptions<TEntity> = {},
  ): Promise<number[]> {
    return this.runTerminal(
      [expression, alias, options] as [typeof expression, typeof alias, typeof options],
      async (expression, alias, options) => {
        const dialect = this.#binding.dialect;
        const { text, params } = buildProjectionQuery(
          dialect,
          this.table,
          expression,
          alias,
          this.transformQuery(options),
        );
        const rows = await this.connection.unsafe<Record<string, number | string | null>>(
          text,
          params,
        );

        return rows.flatMap((row) => {
          const value = row[alias];
          return value === null || value === undefined ? [] : [Number(value)];
        });
      },
    );
  }

  protected countGroupedBy<K extends keyof TEntity & string>(
    column: K,
    where: QueryWhere<TEntity> = {},
  ): Promise<Array<{ value: TEntity[K] | null; count: number }>> {
    return this.runTerminal(
      [column, where] as [typeof column, typeof where],
      async (column, where) => {
        const dialect = this.#binding.dialect;
        const plan = this.transformQuery({ where });
        const { text, params } = buildGroupedCountQuery(
          dialect,
          this.table,
          column,
          plan.where ?? {},
        );
        const rows = await this.connection.unsafe<ValueCountRow<TEntity[K]>>(text, params);

        return rows.map(({ value, count }) => ({
          value,
          count: Number(count),
        }));
      },
    );
  }

  findByHasManyRelation<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    ForeignKey extends keyof TEntity & string,
  >(
    relation: HasManyRelation<TParent, TEntity, LocalKey, ForeignKey>,
    parentId: TParent[LocalKey],
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<TEntity[]> {
    return this.runTerminal(
      [relation, parentId, options] as [typeof relation, typeof parentId, typeof options],
      async (relation, parentId, options) => {
        return await this.findWhere(
          {
            [relation.foreignKey]: parentId,
          } as unknown as QueryWhere<TEntity>,
          options,
        );
      },
    );
  }

  loadHasManyForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    ForeignKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: HasManyRelation<TParent, TEntity, LocalKey, ForeignKey>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<Map<TParent[LocalKey], TEntity[]>> {
    return this.runTerminal(
      [parents, relation, options] as [typeof parents, typeof relation, typeof options],
      async (parents, relation, options) => {
        if (parents.length === 0) {
          return indexHasManyRelation(parents, [], relation);
        }

        const parentIds = [...new Set(parents.map((parent) => parent[relation.localKey]))];
        const where = {
          [relation.foreignKey]: parentIds,
        } as unknown as QueryWhere<TEntity>;
        const children = await this.findRelationRows(where, options, relation.foreignKey);

        return indexHasManyRelation(parents, children, relation);
      },
    );
  }

  findHasManyThrough<
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
    return this.runTerminal(
      [parentId, relation, options] as [typeof parentId, typeof relation, typeof options],
      async (parentId, relation, options) => {
        const grouped = await this.loadHasManyThroughForParents(
          [{ [relation.localKey]: parentId } as TParent],
          relation,
          options,
        );
        return getByRelationKey(grouped, parentId) ?? [];
      },
    );
  }

  loadHasManyThroughForParents<
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
    return this.runTerminal(
      [parents, relation, options] as [typeof parents, typeof relation, typeof options],
      async (parents, relation, options) => {
        if (parents.length === 0) {
          return indexHasManyThroughRelation(parents, [], relation);
        }

        options = this.transformQuery(options);
        if (options.joins?.some((join) => join.table === relation.throughTable)) {
          throw new Error(
            "A related model scope joins the through table twice; use an explicitly aliased correlated predicate instead.",
          );
        }
        const dialect = this.#binding.dialect;
        const parentIds = [...new Set(parents.map((parent) => parent[relation.localKey]))];
        const { text, params } = buildHasManyThroughQuery(
          dialect,
          this.table,
          relation,
          parentIds,
          options,
        );
        const children = await this.connection.unsafe<TEntity & Record<string, unknown>>(
          text,
          params,
        );
        for (const child of children) delete child[EAGER_ROW_NUMBER];

        return indexHasManyThroughRelation(
          parents,
          children.map((row) => this.hydrateRow(row) as TEntity & Record<string, unknown>),
          relation,
        );
      },
    );
  }

  loadBelongsToForParents<
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
    return this.runTerminal(
      [children, relation, parentRepository, options] as [
        typeof children,
        typeof relation,
        typeof parentRepository,
        typeof options,
      ],
      async (children, relation, parentRepository, options) => {
        if (children.length === 0) {
          return new Map();
        }

        const ownerIds = [...new Set(children.map((child) => child[relation.foreignKey]))];
        const parents = await this.relatedRepository(parentRepository).findWhere(
          {
            [relation.ownerKey]: ownerIds,
          } as unknown as QueryWhere<TParent>,
          options,
        );

        return indexBelongsToRelation(children, parents, relation);
      },
    );
  }

  loadMorphManyForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    MorphTypeKey extends keyof TEntity & string,
    MorphIdKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: MorphManyRelation<TParent, TEntity, LocalKey, MorphTypeKey, MorphIdKey>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<Map<TParent[LocalKey], TEntity[]>> {
    return this.runTerminal(
      [parents, relation, options] as [typeof parents, typeof relation, typeof options],
      async (parents, relation, options) => {
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
      },
    );
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

  loadMorphOneForParents<
    TParent extends object,
    LocalKey extends keyof TParent & string,
    MorphTypeKey extends keyof TEntity & string,
    MorphIdKey extends keyof TEntity & string,
  >(
    parents: readonly TParent[],
    relation: MorphOneRelation<TParent, TEntity, LocalKey, MorphTypeKey, MorphIdKey>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<Map<TParent[LocalKey], TEntity | undefined>> {
    return this.runTerminal(
      [parents, relation, options] as [typeof parents, typeof relation, typeof options],
      async (parents, relation, options) => {
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
      },
    );
  }

  loadMorphToForChildren<
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
    return this.runTerminal(
      [children, relation, repositoriesByType, options] as [
        typeof children,
        typeof relation,
        typeof repositoriesByType,
        typeof options,
      ],
      async (children, relation, repositoriesByType, options) => {
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
            const parents = await this.relatedRepository(repository).findWhere(
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
      },
    );
  }

  loadBelongsToManyForParents<
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
    return this.runTerminal(
      [parents, relation, relatedRepository, options] as [
        typeof parents,
        typeof relation,
        typeof relatedRepository,
        typeof options,
      ],
      async (parents, relation, relatedRepository, options) => {
        if (parents.length === 0) {
          return indexBelongsToManyRelation(parents, [], [], relation);
        }

        const dialect = this.#binding.dialect;
        const parentIds = [...new Set(parents.map((parent) => parent[relation.parentKey]))];
        const { text, params } = buildPivotLookupQuery(dialect, relation, parentIds);
        const pivotRows = await this.connection.unsafe<Pivot>(text, params);

        if (pivotRows.length === 0) {
          return indexBelongsToManyRelation(parents, [], [], relation);
        }

        const relatedIds = [
          ...new Set(
            pivotRows.map(
              (row) => row[relation.relatedPivotKey] as unknown as TRelated[RelatedKey],
            ),
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
                      left: {
                        table: relatedRepository.table.name,
                        column: relation.relatedKey,
                      },
                      right: {
                        table: relation.pivotTable,
                        column: relation.relatedPivotKey,
                      },
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
        const relatedRows = await this.relatedRepository(relatedRepository).findWhere(
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
      },
    );
  }
}

export { BaseRepository, getRepositoryBinding };
export default BaseRepository;
