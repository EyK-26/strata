import db from "../../db/connection";
import {
  buildCountQuery,
  buildDeleteByIdQuery,
  buildGroupedCountQuery,
  buildInsertQuery,
  buildProjectionQuery,
  buildRestoreByIdQuery,
  buildSelectQuery,
  buildSoftDeleteByIdQuery,
  buildUpdateQuery,
  qualifyColumn,
  resolveSoftDeleteColumn,
} from "./query.ts";
import { eventBus, modelEventName } from "../events/index.ts";
import {
  indexBelongsToRelation,
  indexHasManyRelation,
  type BelongsToRelation,
  type HasManyRelation,
} from "./relationships.ts";
import { withDatabaseErrorHandling } from "./errors.ts";
import type { TableDefinition } from "./table.ts";
import type {
  MutationValues,
  QueryOptions,
  QueryWhere,
  UpdateValues,
} from "./types.ts";
import {
  buildPaginationMeta,
  type PaginatedResult,
} from "../pagination/index.ts";

interface DatabaseConnection {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
}

type CountRow = { count: number | string };
type ValueCountRow<TValue> = { value: TValue | null; count: number | string };
type DeletedRow = { deleted_id: string | number };

type ErrorFactory<TValue> = (value: TValue) => Error;

class BaseRepository<
  TEntity extends object,
  PrimaryKey extends keyof TEntity & string,
> {
  constructor(
    protected readonly table: TableDefinition<TEntity, PrimaryKey>,
    protected readonly connection: DatabaseConnection = db,
  ) {}

  async findAll(options: QueryOptions<TEntity> = {}): Promise<TEntity[]> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildSelectQuery(this.table, options);
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
    } & Omit<QueryOptions<TEntity>, "limit" | "offset">,
  ): Promise<PaginatedResult<TEntity>> {
    const where = options.where ?? {};
    const total = await this.countWhere(where, {
      withTrashed: options.withTrashed,
      onlyTrashed: options.onlyTrashed,
    });
    const offset = (options.page - 1) * options.perPage;
    const { page, perPage, ...queryOptions } = options;
    const data = await this.findAll({
      ...queryOptions,
      where,
      limit: perPage,
      offset,
    });

    return {
      data,
      meta: buildPaginationMeta({ page, perPage, total }),
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

    throw (
      errorFactory?.(id) ??
      new Error(`${this.table.name} ${String(id)} was not found.`)
    );
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

  async create(values: MutationValues<TEntity>): Promise<TEntity> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildInsertQuery(this.table, values);
      const [record] = await this.connection.unsafe<
        TEntity & Record<string, unknown>
      >(text, params);

      if (!record) {
        throw new Error(
          `Insert into ${this.table.name} did not return a record.`,
        );
      }

      const entity = record as TEntity;
      await eventBus.dispatch(
        modelEventName(this.table.name, "created"),
        entity,
      );
      return entity;
    });
  }

  async updateById(
    id: TEntity[PrimaryKey],
    changes: UpdateValues<TEntity, PrimaryKey>,
  ): Promise<TEntity | null> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildUpdateQuery(this.table, id, changes);
      const [record] = await this.connection.unsafe<
        TEntity & Record<string, unknown>
      >(text, params);

      const entity = (record as TEntity | undefined) ?? null;

      if (entity) {
        await eventBus.dispatch(
          modelEventName(this.table.name, "updated"),
          entity,
        );
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

    throw (
      errorFactory?.(id) ??
      new Error(`${this.table.name} ${String(id)} was not found.`)
    );
  }

  async deleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    if (resolveSoftDeleteColumn(this.table)) {
      return await this.softDeleteById(id);
    }

    return await this.forceDeleteById(id);
  }

  async softDeleteById(id: TEntity[PrimaryKey]): Promise<boolean> {
    return await withDatabaseErrorHandling(async () => {
      const { text, params } = buildSoftDeleteByIdQuery(
        this.table,
        id,
        new Date(),
      );
      const [record] = await this.connection.unsafe<
        TEntity & Record<string, unknown>
      >(text, params);

      if (!record) {
        return false;
      }

      await eventBus.dispatch(
        modelEventName(this.table.name, "deleted"),
        record as TEntity,
      );
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
      const [record] = await this.connection.unsafe<
        TEntity & Record<string, unknown>
      >(text, params);

      if (!record) {
        return null;
      }

      const entity = record as TEntity;
      await eventBus.dispatch(
        modelEventName(this.table.name, "restored"),
        entity,
      );
      return entity;
    });
  }

  withConnection(connection: DatabaseConnection): this {
    const clone = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(clone, this);
    (clone as unknown as { connection: DatabaseConnection }).connection =
      connection;
    return clone;
  }

  protected async findWhere(
    where: QueryWhere<TEntity>,
    options: Omit<QueryOptions<TEntity>, "where"> = {},
  ): Promise<TEntity[]> {
    return await this.findAll({ ...options, where });
  }

  protected async countWhere(
    where: QueryWhere<TEntity> = {},
    options: Pick<QueryOptions<TEntity>, "withTrashed" | "onlyTrashed"> = {},
  ): Promise<number> {
    const { text, params } = buildCountQuery(this.table, where, options);
    const [row] = await this.connection.unsafe<CountRow>(text, params);
    return Number(row?.count ?? 0);
  }

  protected async averageColumn(
    column: keyof TEntity & string,
    where: QueryWhere<TEntity> = {},
  ): Promise<number> {
    const qualifiedColumn = qualifyColumn(this.table.name, column);
    return await this.averageExpression(
      `AVG(${qualifiedColumn})`,
      "value",
      where,
    );
  }

  protected async averageExpression(
    expression: string,
    alias: string,
    where: QueryWhere<TEntity> = {},
  ): Promise<number> {
    const { text, params } = buildProjectionQuery(
      this.table,
      expression,
      alias,
      { where },
    );
    const [row] = await this.connection.unsafe<
      Record<string, number | string | null>
    >(text, params);

    return Math.round(Number(row?.[alias] ?? 0));
  }

  protected async pluckNumberValues(
    expression: string,
    alias: string,
    options: QueryOptions<TEntity> = {},
  ): Promise<number[]> {
    const { text, params } = buildProjectionQuery(
      this.table,
      expression,
      alias,
      options,
    );
    const rows = await this.connection.unsafe<
      Record<string, number | string | null>
    >(text, params);

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
    const rows = await this.connection.unsafe<ValueCountRow<TEntity[K]>>(
      text,
      params,
    );

    return rows.map(({ value, count }) => ({
      value,
      count: Number(count),
    }));
  }

  protected async findByHasManyRelation<
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

  protected async loadHasManyForParents<
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

    const parentIds = [
      ...new Set(parents.map((parent) => parent[relation.localKey])),
    ];
    const children = await this.findWhere(
      {
        [relation.foreignKey]: parentIds,
      } as unknown as QueryWhere<TEntity>,
      options,
    );

    return indexHasManyRelation(parents, children, relation);
  }

  protected async loadBelongsToForParents<
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

    const ownerIds = [
      ...new Set(children.map((child) => child[relation.foreignKey])),
    ];
    const parents = await parentRepository
      .withConnection(this.connection)
      .findWhere(
        {
          [relation.ownerKey]: ownerIds,
        } as unknown as QueryWhere<TParent>,
        options,
      );

    return indexBelongsToRelation(children, parents, relation);
  }
}

export default BaseRepository;
export type { DatabaseConnection };
