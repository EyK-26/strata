import { eventBus, modelEventName } from "../events/index.ts";
import {
  buildPaginationMeta,
  type CursorPaginatedResult,
  type PaginatedResult,
} from "../pagination/index.ts";
import { withDatabaseErrorHandling } from "./errors.ts";
import {
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildIncrementQuery,
  buildInsertQuery,
  buildProjectionQuery,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  buildUpsertQuery,
  qualifyColumn,
  quoteIdentifier,
  resolveSoftDeleteColumn,
} from "./query.ts";
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
import type { MutationValues, QueryOptions, QueryWhere, UpdateValues } from "./types.ts";
import type { WhereNode } from "./whereBuilder.ts";

type ExtendedQueryOptions<TEntity extends object> = QueryOptions<TEntity> & {
  whereNodes?: WhereNode<TEntity>[];
};

interface DatabaseConnection {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  begin?<T>(callback: (transaction: DatabaseConnection) => Promise<T>): Promise<T>;
  /** SQLite closes synchronously; pooled drivers return a promise. */
  close?(): void | Promise<void>;
}

interface SqlDatabaseConnection extends DatabaseConnection {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
}

type CountRow = { count: number | string };
type ValueCountRow<TValue> = { value: TValue | null; count: number | string };
type DeletedRow = { deleted_id: string | number };

type ErrorFactory<TValue> = (value: TValue) => Error;

class BaseRepository<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  constructor(
    protected readonly table: TableDefinition<TEntity, PrimaryKey>,
    protected readonly connection: DatabaseConnection = repositoryConnection,
  ) {}

  async count(options: ExtendedQueryOptions<TEntity> = {}): Promise<number> {
    const { whereNodes, where, ...rest } = options;
    return await this.countWhere(where ?? {}, rest, whereNodes ?? []);
  }

  async findAll(options: ExtendedQueryOptions<TEntity> = {}): Promise<TEntity[]> {
    return await withDatabaseErrorHandling(async () => {
      const { whereNodes, ...queryOptions } = options;
      const { text, params } = buildSelectQuery(this.table, queryOptions, whereNodes ?? []);
      return (await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      )) as TEntity[];
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
      meta: buildPaginationMeta({ page, perPage, total }),
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

    const cursorWhere: QueryWhere<TEntity> = { ...where };

    if (cursor !== undefined) {
      (cursorWhere as Record<string, unknown>)[cursorColumn] =
        direction === "asc" ? { gt: cursor } : { lt: cursor };
    }

    const rows = await this.findAll({
      ...queryOptions,
      where: cursorWhere,
      whereNodes,
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
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildInsertQuery(this.table, values);
      const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      );

      if (!record) {
        throw new Error(`Insert into ${this.table.name} did not return a record.`);
      }

      const entity = record as TEntity;
      await eventBus.dispatch(modelEventName(this.table.name, "created"), entity);
      return entity;
    });
  }

  async updateById(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildUpdateQuery(this.table, id, changes);
      const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      );

      const entity = (record as TEntity | undefined) ?? null;

      if (entity) {
        await eventBus.dispatch(modelEventName(this.table.name, "updated"), entity);
      }

      return entity;
    });
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
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildSoftDeleteByIdQuery(this.table, id, new Date());
      const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      );

      if (!record) {
        return false;
      }

      await eventBus.dispatch(modelEventName(this.table.name, "deleted"), record as TEntity);
      return true;
    });
  }

  async forceDeleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildDeleteByIdQuery(this.table, id);
      const [row] = await this.connection.unsafe<DeletedRow>(text, params);

      if (!row) {
        return false;
      }

      await eventBus.dispatch(modelEventName(this.table.name, "force-deleted"), {
        id,
      });
      return true;
    });
  }

  async restoreById(id: TEntity[PrimaryKey]): Promise<TEntity | null> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildRestoreByIdQuery(this.table, id);
      const [record] = await this.connection.unsafe<TEntity & Record<string, unknown>>(
        text,
        params,
      );

      if (!record) {
        return null;
      }

      const entity = record as TEntity;
      await eventBus.dispatch(modelEventName(this.table.name, "restored"), entity);
      return entity;
    });
  }

  withConnection(connection: DatabaseConnection): this {
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
    const children = await this.findWhere(
      {
        [relation.foreignKey]: parentIds,
      } as unknown as QueryWhere<TEntity>,
      options,
    );

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

    const parentIds = [...new Set(parents.map((parent) => parent[relation.localKey]))];
    const throughParentKey = relation.throughParentKey ?? "__through_parent_id";
    const farTable = this.table.name;
    const columns = this.table.columns
      .map((column) => `${qualifyColumn(farTable, column)}`)
      .join(", ");
    const placeholders = parentIds.map((_, index) => `$${index + 1}`).join(", ");
    const { text: extraWhere, params: extraParams } = this.buildThroughWhere(
      options,
      parentIds.length,
    );
    const softDelete = this.throughSoftDeleteClause(options);
    const sql = `SELECT ${columns}, ${qualifyColumn(relation.throughTable, relation.firstKey)} AS ${throughParentKey} FROM ${quoteIdentifier(farTable)} INNER JOIN ${quoteIdentifier(relation.throughTable)} ON ${qualifyColumn(relation.throughTable, relation.secondLocalKey)} = ${qualifyColumn(farTable, relation.secondKey)} WHERE ${qualifyColumn(relation.throughTable, relation.firstKey)} IN (${placeholders})${softDelete}${extraWhere}`;

    const children = await this.connection.unsafe<TEntity & Record<string, unknown>>(sql, [
      ...parentIds,
      ...extraParams,
    ]);

    return indexHasManyThroughRelation(parents, children, relation);
  }

  private throughSoftDeleteClause(options: QueryOptions<TEntity>): string {
    const column = resolveSoftDeleteColumn(this.table);
    if (!column) {
      return "";
    }
    const qualified = qualifyColumn(this.table.name, column);
    if (options.onlyTrashed) {
      return ` AND ${qualified} IS NOT NULL`;
    }
    if (options.withTrashed) {
      return "";
    }
    return ` AND ${qualified} IS NULL`;
  }

  private buildThroughWhere(
    options: QueryOptions<TEntity>,
    paramOffset = 1,
  ): { text: string; params: unknown[] } {
    const where = options.where ?? {};
    const entries = Object.entries(where);
    if (entries.length === 0) {
      return { text: "", params: [] };
    }

    const params: unknown[] = [];
    const clauses = entries.map(([column, value], index) => {
      params.push(value);
      return `${qualifyColumn(this.table.name, column)} = $${paramOffset + index + 1}`;
    });
    return { text: ` AND ${clauses.join(" AND ")}`, params };
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
    const children = await this.findWhere(
      {
        [relation.morphTypeKey]: relation.morphType,
        [relation.morphIdKey]: parentIds,
      } as unknown as QueryWhere<TEntity>,
      options,
    );

    return indexMorphManyRelation(parents, children, relation);
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
    const placeholders = parentIds.map((_, index) => `$${index + 1}`).join(", ");
    const pivotRows = await this.connection.unsafe<Pivot>(
      `SELECT * FROM ${relation.pivotTable} WHERE ${String(relation.foreignPivotKey)} IN (${placeholders})`,
      parentIds,
    );

    if (pivotRows.length === 0) {
      return indexBelongsToManyRelation(parents, [], [], relation);
    }

    const relatedIds = [
      ...new Set(
        pivotRows.map((row) => row[relation.relatedPivotKey] as unknown as TRelated[RelatedKey]),
      ),
    ];
    const relatedRows = await relatedRepository.withConnection(this.connection).findWhere(
      {
        [relation.relatedKey]: relatedIds,
      } as unknown as QueryWhere<TRelated>,
      options,
    );

    return indexBelongsToManyRelation(parents, pivotRows, relatedRows, relation);
  }
}

export { BaseRepository };
export default BaseRepository;
export type { DatabaseConnection, SqlDatabaseConnection };
