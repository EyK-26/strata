import type { PaginatedResult } from "../pagination/index.ts";
import type BaseRepository from "./baseRepository.ts";
import { projectPluck, uniqueColumnSelect } from "./pluck.ts";
import { parseQualifiedColumn } from "./query.ts";
import type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasManyThroughRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
} from "./relationships.ts";
import { getByRelationKey } from "./relationships.ts";
import type { QueryJoin, QueryOptions, QueryWhere } from "./types.ts";
import { WhereBuilder, type WhereNode } from "./whereBuilder.ts";

type LoadedRow = Record<string, unknown>;

type StoredEagerLoad<TEntity extends object> = {
  kind:
    | "hasMany"
    | "belongsTo"
    | "belongsToMany"
    | "hasManyThrough"
    | "morphMany"
    | "morphOne"
    | "morphTo";
  as: string;
  relation:
    | HasManyRelation<TEntity, Record<string, unknown>, keyof TEntity & string, string>
    | BelongsToRelation<TEntity, Record<string, unknown>, keyof TEntity & string, string>
    | BelongsToManyRelation<
        TEntity,
        Record<string, unknown>,
        Record<string, unknown>,
        keyof TEntity & string,
        string,
        string,
        string
      >
    | HasManyThroughRelation<
        TEntity,
        Record<string, unknown>,
        keyof TEntity & string,
        string,
        string,
        string
      >
    | MorphManyRelation<TEntity, Record<string, unknown>, keyof TEntity & string, string, string>
    | MorphOneRelation<TEntity, Record<string, unknown>, keyof TEntity & string, string, string>
    | MorphToRelation<TEntity, keyof TEntity & string, keyof TEntity & string>;
  repository: BaseRepository<Record<string, unknown>, "id">;
  options?: Omit<QueryOptions<Record<string, unknown>>, "where">;
  morphRepositories?: ReadonlyMap<string, BaseRepository<Record<string, unknown>, "id">>;
};

class RepositoryQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  private readonly eagerLoads: StoredEagerLoad<TEntity>[] = [];
  private readonly whereNodes: WhereNode<TEntity>[] = [];

  constructor(
    private readonly repository: BaseRepository<TEntity, PrimaryKey>,
    private whereClause: QueryWhere<TEntity> = {},
    private queryOptions: Omit<QueryOptions<TEntity>, "where"> = {},
  ) {}

  where(input: QueryWhere<TEntity> | ((builder: WhereBuilder<TEntity>) => void)): this {
    if (typeof input === "function") {
      const builder = new WhereBuilder<TEntity>();
      input(builder);
      this.whereNodes.push(...builder.nodes);
      return this;
    }

    this.whereClause = { ...this.whereClause, ...input };
    return this;
  }

  orWhere(input: QueryWhere<TEntity> | ((builder: WhereBuilder<TEntity>) => void)): this {
    if (typeof input === "function") {
      const builder = new WhereBuilder<TEntity>();
      input(builder);

      if (builder.nodes.length > 0) {
        this.whereNodes.push({ kind: "or", group: builder.nodes });
      }

      return this;
    }

    this.whereNodes.push({ kind: "or", where: input });
    return this;
  }

  orderBy(orderBy: QueryOptions<TEntity>["orderBy"]): this {
    this.queryOptions = { ...this.queryOptions, orderBy };
    return this;
  }

  limit(limit: number): this {
    this.queryOptions = { ...this.queryOptions, limit };
    return this;
  }

  whereNull(column: keyof TEntity & string): this {
    return this.where({ [column]: null } as QueryWhere<TEntity>);
  }

  whereNotNull(column: keyof TEntity & string): this {
    return this.where({ [column]: { isNull: false } } as QueryWhere<TEntity>);
  }

  whereIn(column: keyof TEntity & string, values: readonly unknown[]): this {
    return this.where({ [column]: values } as QueryWhere<TEntity>);
  }

  whereExists(sql: string, params: readonly unknown[] = []): this {
    this.whereNodes.push({ kind: "and", exists: { sql, params } });
    return this;
  }

  whereNotExists(sql: string, params: readonly unknown[] = []): this {
    this.whereNodes.push({ kind: "and", exists: { sql, params, not: true } });
    return this;
  }

  offset(offset: number): this {
    this.queryOptions = { ...this.queryOptions, offset };
    return this;
  }

  join(left: `${string}.${string}`, right: `${string}.${string}`): this {
    return this.addJoin("inner", left, right);
  }

  leftJoin(left: `${string}.${string}`, right: `${string}.${string}`): this {
    return this.addJoin("left", left, right);
  }

  groupBy(groupBy: QueryOptions<TEntity>["groupBy"]): this {
    this.queryOptions = { ...this.queryOptions, groupBy };
    return this;
  }

  having(having: QueryWhere<TEntity>): this {
    this.queryOptions = { ...this.queryOptions, having };
    return this;
  }

  withHasMany<
    TChild extends object,
    LocalKey extends keyof TEntity & string,
    ForeignKey extends keyof TChild & string,
    Alias extends string,
  >(
    as: Alias,
    relation: HasManyRelation<TEntity, TChild, LocalKey, ForeignKey>,
    childRepository: BaseRepository<TChild, keyof TChild & string>,
    options: Omit<QueryOptions<TChild>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "hasMany",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: childRepository as unknown as BaseRepository<Record<string, unknown>, "id">,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withBelongsTo<
    TParent extends object,
    ForeignKey extends keyof TEntity & string,
    OwnerKey extends keyof TParent & string,
    Alias extends string,
  >(
    as: Alias,
    relation: BelongsToRelation<TEntity, TParent, ForeignKey, OwnerKey>,
    parentRepository: BaseRepository<TParent, OwnerKey>,
    options: Omit<QueryOptions<TParent>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "belongsTo",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: parentRepository as unknown as BaseRepository<Record<string, unknown>, "id">,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withMorphMany<
    TChild extends object,
    LocalKey extends keyof TEntity & string,
    MorphTypeKey extends keyof TChild & string,
    MorphIdKey extends keyof TChild & string,
    Alias extends string,
  >(
    as: Alias,
    relation: MorphManyRelation<TEntity, TChild, LocalKey, MorphTypeKey, MorphIdKey>,
    childRepository: BaseRepository<TChild, keyof TChild & string>,
    options: Omit<QueryOptions<TChild>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "morphMany",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: childRepository as unknown as BaseRepository<Record<string, unknown>, "id">,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withMorphOne<
    TChild extends object,
    LocalKey extends keyof TEntity & string,
    MorphTypeKey extends keyof TChild & string,
    MorphIdKey extends keyof TChild & string,
    Alias extends string,
  >(
    as: Alias,
    relation: MorphOneRelation<TEntity, TChild, LocalKey, MorphTypeKey, MorphIdKey>,
    childRepository: BaseRepository<TChild, keyof TChild & string>,
    options: Omit<QueryOptions<TChild>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "morphOne",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: childRepository as unknown as BaseRepository<Record<string, unknown>, "id">,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withMorphTo<
    TParent extends object,
    MorphTypeKey extends keyof TEntity & string,
    MorphIdKey extends keyof TEntity & string,
    Alias extends string,
  >(
    as: Alias,
    relation: MorphToRelation<TEntity, MorphTypeKey, MorphIdKey>,
    repositoriesByType: ReadonlyMap<string, BaseRepository<TParent, keyof TParent & string>>,
    options: Omit<QueryOptions<TParent>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "morphTo",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: this.repository as unknown as BaseRepository<Record<string, unknown>, "id">,
      morphRepositories: repositoriesByType as ReadonlyMap<
        string,
        BaseRepository<Record<string, unknown>, "id">
      >,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withBelongsToMany<
    TRelated extends object,
    Pivot extends object,
    ParentKey extends keyof TEntity & string,
    RelatedKey extends keyof TRelated & string,
    ForeignPivotKey extends keyof Pivot & string,
    RelatedPivotKey extends keyof Pivot & string,
    Alias extends string,
  >(
    as: Alias,
    relation: BelongsToManyRelation<
      TEntity,
      TRelated,
      Pivot,
      ParentKey,
      RelatedKey,
      ForeignPivotKey,
      RelatedPivotKey
    >,
    relatedRepository: BaseRepository<TRelated, RelatedKey>,
    options: Omit<QueryOptions<TRelated>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "belongsToMany",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: relatedRepository as unknown as BaseRepository<Record<string, unknown>, "id">,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withHasManyThrough<
    TFar extends object,
    LocalKey extends keyof TEntity & string,
    SecondKey extends keyof TFar & string,
    Alias extends string,
  >(
    as: Alias,
    relation: HasManyThroughRelation<TEntity, TFar, LocalKey, string, string, SecondKey>,
    farRepository: BaseRepository<TFar, keyof TFar & string>,
    options: Omit<QueryOptions<TFar>, "where"> = {},
  ): this {
    this.eagerLoads.push({
      kind: "hasManyThrough",
      as,
      relation: relation as StoredEagerLoad<TEntity>["relation"],
      repository: farRepository as unknown as BaseRepository<Record<string, unknown>, "id">,
      options: options as StoredEagerLoad<TEntity>["options"],
    });
    return this;
  }

  withTrashed(): this {
    this.queryOptions = { ...this.queryOptions, withTrashed: true };
    return this;
  }

  onlyTrashed(): this {
    this.queryOptions = { ...this.queryOptions, onlyTrashed: true };
    return this;
  }

  async get(): Promise<Array<TEntity & LoadedRow>> {
    const rows = await this.repository.findAll(this.buildOptions());
    return await this.attach(rows);
  }

  async first(): Promise<(TEntity & LoadedRow) | null> {
    const rows = await this.repository.findAll({ ...this.buildOptions(), limit: 1 });
    const attached = await this.attach(rows);
    return attached[0] ?? null;
  }

  async count(): Promise<number> {
    return await this.repository.count(this.buildOptions());
  }

  async pluck<K extends keyof TEntity & string>(column: K): Promise<Array<TEntity[K]>>;
  async pluck<K extends keyof TEntity & string, KK extends keyof TEntity & string>(
    column: K,
    keyBy: KK,
  ): Promise<Map<TEntity[KK], TEntity[K]>>;
  async pluck<K extends keyof TEntity & string>(
    column: K,
    keyBy?: keyof TEntity & string,
  ): Promise<Array<TEntity[K]> | Map<TEntity[keyof TEntity & string], TEntity[K]>> {
    const rows = await this.repository.findAll({
      ...this.buildOptions(),
      select: uniqueColumnSelect(
        this.repository.getTable().name,
        keyBy === undefined || keyBy === column ? [column] : [column, keyBy],
      ),
    });

    if (keyBy === undefined) {
      return projectPluck(rows, column);
    }

    return projectPluck(rows, column, keyBy);
  }

  async value<K extends keyof TEntity & string>(column: K): Promise<TEntity[K] | null> {
    const rows = await this.repository.findAll({
      ...this.buildOptions(),
      select: uniqueColumnSelect(this.repository.getTable().name, [column]),
      limit: 1,
    });
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return row[column];
  }

  async attachToRows(rows: readonly TEntity[]): Promise<Array<TEntity & LoadedRow>> {
    return await this.attach(rows);
  }

  async paginate(options: { page: number; perPage: number }): Promise<PaginatedResult<TEntity>> {
    return await this.repository.paginate({
      ...this.buildOptions(),
      page: options.page,
      perPage: options.perPage,
    });
  }

  private buildOptions(): QueryOptions<TEntity> & { whereNodes?: WhereNode<TEntity>[] } {
    return {
      ...this.queryOptions,
      where: this.whereClause,
      whereNodes: this.whereNodes,
    };
  }

  private addJoin(
    type: QueryJoin["type"],
    left: `${string}.${string}`,
    right: `${string}.${string}`,
  ): this {
    const leftRef = parseQualifiedColumn(left);
    const rightRef = parseQualifiedColumn(right);
    const table = type === "inner" ? rightRef.table : rightRef.table;
    const joins = this.queryOptions.joins ?? [];
    const existing = joins.find((join) => join.table === table && join.type === type);

    if (existing) {
      existing.on.push({ left: leftRef, right: rightRef });
      return this;
    }

    this.queryOptions = {
      ...this.queryOptions,
      joins: [
        ...joins,
        {
          type,
          table,
          on: [{ left: leftRef, right: rightRef }],
        },
      ],
    };

    return this;
  }

  private async attach(rows: readonly TEntity[]): Promise<Array<TEntity & LoadedRow>> {
    const result = rows.map((row) => ({ ...row })) as Array<TEntity & LoadedRow>;
    if (result.length === 0 || this.eagerLoads.length === 0) {
      return result;
    }

    await Promise.all(this.eagerLoads.map((load) => this.hydrateEagerLoad(rows, result, load)));
    return result;
  }

  private async hydrateEagerLoad(
    rows: readonly TEntity[],
    result: Array<TEntity & LoadedRow>,
    load: StoredEagerLoad<TEntity>,
  ): Promise<void> {
    if (load.kind === "hasMany") {
      const relation = load.relation as HasManyRelation<
        TEntity,
        Record<string, unknown>,
        keyof TEntity & string,
        string
      >;
      const grouped = await load.repository
        .withConnection(this.repository.getConnection())
        .loadHasManyForParents(rows, relation, load.options);
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]) ?? [];
      }
      return;
    }

    if (load.kind === "morphMany") {
      const relation = load.relation as MorphManyRelation<
        TEntity,
        Record<string, unknown>,
        keyof TEntity & string,
        string,
        string
      >;
      const grouped = await load.repository
        .withConnection(this.repository.getConnection())
        .loadMorphManyForParents(rows, relation, load.options);
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]) ?? [];
      }
      return;
    }

    if (load.kind === "morphOne") {
      const relation = load.relation as MorphOneRelation<
        TEntity,
        Record<string, unknown>,
        keyof TEntity & string,
        string,
        string
      >;
      const grouped = await load.repository
        .withConnection(this.repository.getConnection())
        .loadMorphOneForParents(rows, relation, load.options);
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]);
      }
      return;
    }

    if (load.kind === "hasManyThrough") {
      const relation = load.relation as HasManyThroughRelation<
        TEntity,
        Record<string, unknown>,
        keyof TEntity & string,
        string,
        string,
        string
      >;
      const grouped = await load.repository
        .withConnection(this.repository.getConnection())
        .loadHasManyThroughForParents(rows, relation, load.options);
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]) ?? [];
      }
      return;
    }

    if (load.kind === "belongsToMany") {
      const relation = load.relation as BelongsToManyRelation<
        TEntity,
        Record<string, unknown>,
        Record<string, unknown>,
        keyof TEntity & string,
        string,
        string,
        string
      >;
      const grouped = await this.repository.loadBelongsToManyForParents(
        rows,
        relation,
        load.repository as never,
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.parentKey]) ?? [];
      }
      return;
    }

    if (load.kind === "morphTo") {
      const relation = load.relation as MorphToRelation<
        TEntity,
        keyof TEntity & string,
        keyof TEntity & string
      >;
      const grouped = await this.repository.loadMorphToForChildren(
        rows,
        relation,
        load.morphRepositories ?? new Map(),
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(
          grouped,
          row[relation.morphIdKey as keyof TEntity],
        );
      }
      return;
    }

    const relation = load.relation as BelongsToRelation<
      TEntity,
      Record<string, unknown>,
      keyof TEntity & string,
      string
    >;
    const grouped = await this.repository.loadBelongsToForParents(
      rows,
      relation,
      load.repository,
      load.options,
    );
    for (const row of result) {
      (row as LoadedRow)[load.as] = getByRelationKey(
        grouped,
        row[relation.foreignKey as keyof TEntity],
      );
    }
  }
}

export { projectPluck, uniqueColumnSelect } from "./pluck.ts";
export { RepositoryQuery };
