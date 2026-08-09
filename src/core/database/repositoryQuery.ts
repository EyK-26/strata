import type { PaginatedResult } from "../pagination/index.ts";
import type BaseRepository from "./baseRepository.ts";
import { parseQualifiedColumn } from "./query.ts";
import type {
  BelongsToRelation,
  HasManyRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
} from "./relationships.ts";
import type { QueryJoin, QueryOptions, QueryWhere } from "./types.ts";
import { WhereBuilder, type WhereNode } from "./whereBuilder.ts";

type LoadedRow = Record<string, unknown>;

type StoredEagerLoad<TEntity extends object> = {
  kind: "hasMany" | "belongsTo" | "morphMany" | "morphOne" | "morphTo";
  as: string;
  relation:
    | HasManyRelation<TEntity, Record<string, unknown>, keyof TEntity & string, string>
    | BelongsToRelation<TEntity, Record<string, unknown>, keyof TEntity & string, string>
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

  async get(): Promise<Array<TEntity & LoadedRow>> {
    const rows = await this.repository.findAll(this.buildOptions());
    return await this.attach(rows);
  }

  async first(): Promise<(TEntity & LoadedRow) | null> {
    const rows = await this.get();
    return rows[0] ?? null;
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
    if (rows.length === 0 || this.eagerLoads.length === 0) {
      return rows.map((row) => ({ ...row })) as Array<TEntity & LoadedRow>;
    }

    let result: Array<TEntity & LoadedRow> = rows.map((row) => ({ ...row })) as Array<
      TEntity & LoadedRow
    >;

    for (const load of this.eagerLoads) {
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
        result = result.map((row) => ({
          ...row,
          [load.as]: grouped.get(row[relation.localKey]) ?? [],
        })) as Array<TEntity & LoadedRow>;
        continue;
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
        result = result.map((row) => ({
          ...row,
          [load.as]: grouped.get(row[relation.localKey]) ?? [],
        })) as Array<TEntity & LoadedRow>;
        continue;
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
        result = result.map((row) => ({
          ...row,
          [load.as]: grouped.get(row[relation.localKey]),
        })) as Array<TEntity & LoadedRow>;
        continue;
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
        result = result.map((row) => ({
          ...row,
          [load.as]: grouped.get(row[relation.morphIdKey as keyof TEntity] as never),
        })) as Array<TEntity & LoadedRow>;
        continue;
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
      result = result.map((row) => ({
        ...row,
        [load.as]: grouped.get(row[relation.foreignKey as keyof TEntity] as never),
      })) as Array<TEntity & LoadedRow>;
    }

    return result;
  }
}

export { RepositoryQuery };
