import { NotFoundError } from "@getstrata/core/errors/http";
import type BaseRepository from "./baseRepository.ts";
import { foreignKeyFromTable, pivotTableName } from "./inflection.ts";
import { resolveSoftDeleteColumn } from "./query.ts";
import type { AnyRelationQuery, RelatedModelClass } from "./relationQuery.ts";
import {
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  HasManyRelationQuery,
  HasOneRelationQuery,
} from "./relationQuery.ts";
import type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasOneRelation,
} from "./relationships.ts";
import {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  indexBelongsToManyRelation,
} from "./relationships.ts";
import type { RepositoryQuery } from "./repositoryQuery.ts";
import type { MutationValues, QueryOptions, QueryWhere, UpdateValues } from "./types.ts";

type CastType = "date" | "datetime" | "json" | "bool" | "boolean";
type LoadedAttributes = Record<string, unknown>;
type ModelCasts = Partial<Record<string, CastType>>;

type GlobalScopeFn<TEntity extends object, PrimaryKey extends keyof TEntity & string> = (
  query: RepositoryQuery<TEntity, PrimaryKey>,
) => RepositoryQuery<TEntity, PrimaryKey>;

type ModelClassType<
  TEntity extends object,
  PrimaryKey extends keyof TEntity & string,
> = typeof Model &
  (new (
    attributes: TEntity,
    repository: BaseRepository<TEntity, PrimaryKey>,
    exists?: boolean,
  ) => Model<TEntity, PrimaryKey>);

interface ModelConstructor<
  TEntity extends object,
  PrimaryKey extends keyof TEntity & string,
  TModel extends Model<TEntity, PrimaryKey>,
> extends ModelClassType<TEntity, PrimaryKey> {
  new (
    attributes: TEntity,
    repository: BaseRepository<TEntity, PrimaryKey>,
    exists?: boolean,
  ): TModel;
}

const modelRepositories = new WeakMap<object, BaseRepository<Record<string, unknown>, "id">>();
const modelGlobalScopes = new WeakMap<object, GlobalScopeFn<Record<string, unknown>, "id">[]>();
const modelBooted = new WeakSet<object>();

function resolveModelRepository(model: object): BaseRepository<Record<string, unknown>, "id"> {
  const repository = modelRepositories.get(model);

  if (!repository) {
    throw new Error(`${(model as { name: string }).name}.repository() is not implemented.`);
  }

  return repository;
}

function modelStatics(model: object): typeof Model {
  return model as typeof Model;
}

function ensureBooted(model: object): void {
  if (modelBooted.has(model)) {
    return;
  }

  modelBooted.add(model);

  const boot = (model as { boot?: () => void }).boot;

  if (typeof boot === "function") {
    boot.call(model);
  }
}

function getGlobalScopes(model: object): GlobalScopeFn<Record<string, unknown>, "id">[] {
  return modelGlobalScopes.get(model) ?? [];
}

function hydrateValue(value: unknown, cast: CastType): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  switch (cast) {
    case "date":
    case "datetime":
      return value instanceof Date ? value : new Date(String(value));
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "bool":
    case "boolean":
      return value === true || value === 1 || value === "1" || value === "true";
    default:
      return value;
  }
}

function dehydrateValue(value: unknown, cast: CastType): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  switch (cast) {
    case "date":
    case "datetime":
      return value instanceof Date ? value : new Date(String(value));
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "bool":
    case "boolean":
      return Boolean(value);
    default:
      return value;
  }
}

function filterMassAssignable(
  fillable: readonly string[] | undefined,
  guarded: readonly string[] | true | undefined,
  input: LoadedAttributes,
): LoadedAttributes {
  const resolvedGuarded = guarded ?? true;

  if (fillable && fillable.length > 0) {
    const allowed = new Set(fillable);
    return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
  }

  if (resolvedGuarded === true || resolvedGuarded.includes("*")) {
    return {};
  }

  const blocked = new Set(resolvedGuarded);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !blocked.has(key)));
}

function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "hydrate" | "dehydrate",
): LoadedAttributes {
  if (Object.keys(casts).length === 0) {
    return values;
  }

  const result = { ...values };
  const castFn = direction === "hydrate" ? hydrateValue : dehydrateValue;

  for (const [key, cast] of Object.entries(casts)) {
    if (key in result && cast) {
      result[key] = castFn(result[key], cast);
    }
  }

  return result;
}

function applyTimestampsOnCreate(
  columns: readonly string[],
  values: LoadedAttributes,
  enabled: boolean,
): LoadedAttributes {
  if (!enabled) {
    return values;
  }

  const now = new Date();
  const result = { ...values };

  if (columns.includes("created_at")) {
    result.created_at = now;
  }

  if (columns.includes("updated_at")) {
    result.updated_at = now;
  }

  return result;
}

function applyTimestampsOnUpdate(
  columns: readonly string[],
  values: LoadedAttributes,
  enabled: boolean,
): LoadedAttributes {
  if (!enabled) {
    return values;
  }

  const result = { ...values };

  if (columns.includes("updated_at")) {
    result.updated_at = new Date();
  }

  return result;
}

class Model<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  static $fillable?: readonly string[];
  static $guarded?: readonly string[] | true;
  static $casts: ModelCasts = {};
  static $timestamps = true;

  private _exists: boolean;
  private readonly loadedRelations: Record<string, unknown> = {};

  constructor(
    protected attributes: TEntity,
    protected readonly repository: BaseRepository<TEntity, PrimaryKey>,
    exists = true,
  ) {
    this._exists = exists;
  }

  getRepository(): BaseRepository<TEntity, PrimaryKey> {
    return this.repository;
  }

  get $exists(): boolean {
    return this._exists;
  }

  get<K extends keyof TEntity>(key: K): TEntity[K] {
    return this.attributes[key];
  }

  get id(): TEntity[PrimaryKey] {
    return this.attributes[this.primaryKey()];
  }

  toObject(): TEntity {
    return { ...this.attributes };
  }

  protected primaryKey(): PrimaryKey {
    throw new Error(`${this.constructor.name}.primaryKey() is not implemented.`);
  }

  protected static primaryKeyField(this: object): string {
    return resolveModelRepository(this).getTable().primaryKey;
  }

  protected static hydrateAttributes<TEntity extends object>(
    this: object,
    attributes: TEntity,
  ): TEntity {
    const casts = modelStatics(this).$casts ?? {};
    return applyCasts(attributes as LoadedAttributes, casts, "hydrate") as TEntity;
  }

  protected static dehydrateAttributes(
    this: object,
    attributes: LoadedAttributes,
  ): LoadedAttributes {
    const casts = modelStatics(this).$casts ?? {};
    return applyCasts(attributes, casts, "dehydrate");
  }

  protected static fromRecord<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
    record: TEntity,
    repository: BaseRepository<TEntity, PrimaryKey>,
    exists = true,
  ): Model<TEntity, PrimaryKey> {
    const statics = modelStatics(this);
    const hydrated = statics.hydrateAttributes(record);
    return new (statics as ModelClassType<TEntity, PrimaryKey>)(hydrated, repository, exists);
  }

  static boot(): void {}

  static addGlobalScope<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
    _name: string,
    scope: GlobalScopeFn<TEntity, PrimaryKey>,
  ): void {
    ensureBooted(this);
    const existing = modelGlobalScopes.get(this) ?? [];
    modelGlobalScopes.set(this, [
      ...existing,
      scope as unknown as GlobalScopeFn<Record<string, unknown>, "id">,
    ]);
  }

  static repository<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
  ): BaseRepository<TEntity, PrimaryKey> {
    return resolveModelRepository(this) as unknown as BaseRepository<TEntity, PrimaryKey>;
  }

  static query<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
  ): RepositoryQuery<TEntity, PrimaryKey> {
    ensureBooted(this);
    const repository = resolveModelRepository(this) as unknown as BaseRepository<
      TEntity,
      PrimaryKey
    >;
    let query = repository.query();

    for (const scope of getGlobalScopes(this)) {
      query = (scope as unknown as GlobalScopeFn<TEntity, PrimaryKey>)(query);
    }

    return query;
  }

  static newFromRecord(
    this: object,
    record: object,
    exists = true,
  ): Model<Record<string, unknown>, "id"> {
    const repository = resolveModelRepository(this);
    return modelStatics(this).fromRecord(
      record as never,
      repository as never,
      exists,
    ) as unknown as Model<Record<string, unknown>, "id">;
  }

  static async create(
    this: object,
    attributes: Record<string, unknown>,
    forced: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    const statics = modelStatics(this);
    ensureBooted(this);
    const repository = resolveModelRepository(this);
    const table = repository.getTable();
    const timestamps = statics.$timestamps ?? true;
    const assignable = {
      ...filterMassAssignable(statics.$fillable, statics.$guarded, attributes),
      ...forced,
    };
    const withTimestamps = applyTimestampsOnCreate(table.columns, assignable, timestamps);
    const payload = statics.dehydrateAttributes(withTimestamps);
    const record = await repository.create(payload as MutationValues<object>);
    return statics.fromRecord(record, repository, true);
  }

  static with(
    this: object,
    ...relations: string[]
  ): {
    get(): Promise<Array<Model<Record<string, unknown>, "id">>>;
    first(): Promise<Model<Record<string, unknown>, "id"> | null>;
  } {
    const statics = modelStatics(this);
    ensureBooted(this);
    const repository = resolveModelRepository(this);
    const dummy = statics.fromRecord({} as never, repository as never, false);
    const resolved = relations.map((name) => {
      const method = (dummy as unknown as Record<string, unknown>)[name];

      if (typeof method !== "function") {
        throw new Error(`${(this as { name: string }).name} has no relation method ${name}().`);
      }

      const relationQuery = method.call(dummy) as AnyRelationQuery;
      return { name, relationQuery };
    });

    const query = (
      Model.query as (this: object) => RepositoryQuery<Record<string, unknown>, "id">
    ).call(this);

    for (const { name, relationQuery } of resolved) {
      if (relationQuery.kind !== "belongsToMany") {
        relationQuery.applyEagerLoad(query as never, name);
      }
    }

    return {
      async get() {
        const rows = await query.get();
        const models: Array<Model<Record<string, unknown>, "id">> = [];

        for (const row of rows) {
          const model = statics.fromRecord(row, repository, true);

          for (const { name, relationQuery } of resolved) {
            if (relationQuery.kind === "belongsToMany") {
              await model.load(name);
              continue;
            }

            model.setLoaded(name, relationQuery.hydrateEager(row, name));
          }

          models.push(model);
        }

        return models;
      },
      async first() {
        const [model] = await this.get();
        return model ?? null;
      },
    };
  }

  static async find(
    this: object,
    id: unknown,
  ): Promise<Model<Record<string, unknown>, "id"> | null> {
    const statics = modelStatics(this);
    const repository = resolveModelRepository(this);
    const primaryKey = repository.getTable().primaryKey;
    const record = await (
      Model.query as (this: object) => RepositoryQuery<Record<string, unknown>, "id">
    )
      .call(this)
      .where({ [primaryKey]: id } as QueryWhere<object>)
      .first();

    return record ? statics.fromRecord(record, repository, true) : null;
  }

  static async findOrFail(
    this: object,
    id: unknown,
    errorFactory?: (id: unknown) => Error,
  ): Promise<Model<Record<string, unknown>, "id">> {
    const model = await (
      Model.find as (
        this: object,
        value: unknown,
      ) => Promise<Model<Record<string, unknown>, "id"> | null>
    ).call(this, id);

    if (model) {
      return model;
    }

    throw (
      errorFactory?.(id) ??
      new NotFoundError(`${(this as { name: string }).name} ${String(id)} not found.`)
    );
  }

  static async all(
    this: object,
    options: Omit<QueryOptions<object>, "where"> = {},
  ): Promise<Array<Model<Record<string, unknown>, "id">>> {
    const statics = modelStatics(this);
    const repository = resolveModelRepository(this);
    let query = (
      Model.query as (this: object) => RepositoryQuery<Record<string, unknown>, "id">
    ).call(this);

    if (options.orderBy) {
      query = query.orderBy(options.orderBy);
    }

    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }

    const rows = await query.get();
    return rows.map((row) => statics.fromRecord(row, repository, true));
  }

  static async firstWhere(
    this: object,
    where: QueryWhere<object>,
    options: Omit<QueryOptions<object>, "where"> = {},
  ): Promise<Model<Record<string, unknown>, "id"> | null> {
    const statics = modelStatics(this);
    const repository = resolveModelRepository(this);
    let query = (Model.query as (this: object) => RepositoryQuery<Record<string, unknown>, "id">)
      .call(this)
      .where(where);

    if (options.orderBy) {
      query = query.orderBy(options.orderBy);
    }

    const record = await query.first();
    return record ? statics.fromRecord(record, repository, true) : null;
  }

  async save(): Promise<this> {
    const ModelClass = modelStatics(this.constructor);
    const timestamps = ModelClass.$timestamps ?? true;
    const casts = ModelClass.$casts ?? {};
    const table = this.repository.getTable();

    if (this.$exists) {
      const changes = applyTimestampsOnUpdate(
        table.columns,
        applyCasts(this.attributes as LoadedAttributes, casts, "dehydrate"),
        timestamps,
      ) as UpdateValues<TEntity, PrimaryKey>;
      const record = await this.repository.updateByIdOrThrow(this.id, changes);
      this.attributes = ModelClass.hydrateAttributes(record);
      return this;
    }

    const assignable = filterMassAssignable(
      ModelClass.$fillable,
      ModelClass.$guarded,
      this.attributes as LoadedAttributes,
    );
    const withTimestamps = applyTimestampsOnCreate(table.columns, assignable, timestamps);
    const payload = ModelClass.dehydrateAttributes(withTimestamps) as MutationValues<TEntity>;
    const record = await this.repository.create(payload);
    this.attributes = ModelClass.hydrateAttributes(record);
    this._exists = true;
    return this;
  }

  async update(changes: Partial<TEntity>): Promise<this> {
    const ModelClass = modelStatics(this.constructor);
    const assignable = filterMassAssignable(
      ModelClass.$fillable,
      ModelClass.$guarded,
      changes as LoadedAttributes,
    );
    Object.assign(this.attributes as LoadedAttributes, assignable);
    return await this.save();
  }

  async delete(): Promise<boolean> {
    if (resolveSoftDeleteColumn(this.repository.getTable())) {
      return await this.repository.deleteById(this.id);
    }

    return await this.repository.forceDeleteById(this.id);
  }

  async forceDelete(): Promise<boolean> {
    return await this.repository.forceDeleteById(this.id);
  }

  async restore(): Promise<this | null> {
    const ModelClass = modelStatics(this.constructor);
    const record = await this.repository.restoreById(this.id);

    if (!record) {
      return null;
    }

    this.attributes = ModelClass.hydrateAttributes(record);
    return this;
  }

  async loadHasMany<
    TChild extends object,
    LocalKey extends keyof TEntity & string,
    ForeignKey extends keyof TChild & string,
    Alias extends string,
  >(
    as: Alias,
    relation: HasManyRelation<TEntity, TChild, LocalKey, ForeignKey>,
    childRepository: BaseRepository<TChild, keyof TChild & string>,
    options: Omit<QueryOptions<TChild>, "where"> = {},
  ): Promise<this & Record<Alias, TChild[]>> {
    const grouped = await childRepository
      .withConnection(this.repository.getConnection())
      .loadHasManyForParents([this.attributes], relation, options);
    const loaded = grouped.get(this.attributes[relation.localKey]) ?? [];
    return Object.assign(this, { [as]: loaded }) as this & Record<Alias, TChild[]>;
  }

  async loadHasOne<
    TChild extends object,
    LocalKey extends keyof TEntity & string,
    ForeignKey extends keyof TChild & string,
    Alias extends string,
  >(
    as: Alias,
    relation: HasOneRelation<TEntity, TChild, LocalKey, ForeignKey>,
    childRepository: BaseRepository<TChild, keyof TChild & string>,
    options: Omit<QueryOptions<TChild>, "where"> = {},
  ): Promise<this & Record<Alias, TChild | undefined>> {
    const loaded = await this.loadHasMany(
      as,
      relation as unknown as HasManyRelation<TEntity, TChild, LocalKey, ForeignKey>,
      childRepository,
      { ...options, limit: 1 },
    );
    const value = (loaded as Record<Alias, TChild[]>)[as]?.[0];
    return Object.assign(this, { [as]: value }) as this & Record<Alias, TChild | undefined>;
  }

  async loadBelongsTo<
    TParent extends object,
    ForeignKey extends keyof TEntity & string,
    OwnerKey extends keyof TParent & string,
    Alias extends string,
  >(
    as: Alias,
    relation: BelongsToRelation<TEntity, TParent, ForeignKey, OwnerKey>,
    parentRepository: BaseRepository<TParent, OwnerKey>,
    options: Omit<QueryOptions<TParent>, "where"> = {},
  ): Promise<this & Record<Alias, TParent | undefined>> {
    const grouped = await this.repository.loadBelongsToForParents(
      [this.attributes],
      relation,
      parentRepository,
      options,
    );
    const loaded = grouped.get(this.attributes[relation.foreignKey as keyof TEntity] as never);
    return Object.assign(this, { [as]: loaded }) as this & Record<Alias, TParent | undefined>;
  }

  async loadBelongsToMany<
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
  ): Promise<this & Record<Alias, TRelated[]>> {
    const connection = this.repository.getConnection();
    const parentId = this.attributes[relation.parentKey];
    const pivotRows = await connection.unsafe<Pivot>(
      `SELECT * FROM ${relation.pivotTable} WHERE ${String(relation.foreignPivotKey)} = $1`,
      [parentId],
    );

    if (pivotRows.length === 0) {
      return Object.assign(this, { [as]: [] }) as this & Record<Alias, TRelated[]>;
    }

    const relatedIds = [
      ...new Set(
        pivotRows.map((row) => row[relation.relatedPivotKey] as unknown as TRelated[RelatedKey]),
      ),
    ];
    const relatedRows = await relatedRepository.withConnection(connection).findAll({
      ...options,
      where: {
        [relation.relatedKey]: relatedIds,
      } as never,
    });
    const grouped = indexBelongsToManyRelation([this.attributes], pivotRows, relatedRows, relation);
    const loaded = grouped.get(parentId) ?? [];
    return Object.assign(this, { [as]: loaded }) as this & Record<Alias, TRelated[]>;
  }

  hasMany<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedModelClass<TRelated, RelatedKey>,
    foreignKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
  ): HasManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    return new HasManyRelationQuery(
      this,
      related,
      hasMany({
        name: related.repository().getTable().name,
        localKey: localKey ?? table.primaryKey,
        foreignKey: foreignKey ?? (foreignKeyFromTable(table.name) as keyof TRelated & string),
      }),
    );
  }

  hasOne<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedModelClass<TRelated, RelatedKey>,
    foreignKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
  ): HasOneRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    return new HasOneRelationQuery(
      this,
      related,
      hasOne({
        name: related.repository().getTable().name,
        localKey: localKey ?? table.primaryKey,
        foreignKey: foreignKey ?? (foreignKeyFromTable(table.name) as keyof TRelated & string),
      }),
    );
  }

  belongsTo<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedModelClass<TRelated, RelatedKey>,
    foreignKey?: keyof TEntity & string,
    ownerKey?: RelatedKey,
  ): BelongsToRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const relatedTable = related.repository().getTable();
    return new BelongsToRelationQuery(
      this,
      related,
      belongsTo({
        name: relatedTable.name,
        foreignKey:
          foreignKey ?? (foreignKeyFromTable(relatedTable.name) as keyof TEntity & string),
        ownerKey: ownerKey ?? relatedTable.primaryKey,
      }),
    );
  }

  belongsToMany<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    Pivot extends object = Record<string, unknown>,
  >(
    related: RelatedModelClass<TRelated, RelatedKey>,
    pivotTable?: string,
    foreignPivotKey?: keyof Pivot & string,
    relatedPivotKey?: keyof Pivot & string,
  ): BelongsToManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey, Pivot> {
    const table = this.repository.getTable();
    const relatedTable = related.repository().getTable();
    return new BelongsToManyRelationQuery(
      this,
      related,
      belongsToMany({
        name: relatedTable.name,
        pivotTable: pivotTable ?? pivotTableName(table.name, relatedTable.name),
        parentKey: table.primaryKey,
        relatedKey: relatedTable.primaryKey,
        foreignPivotKey:
          foreignPivotKey ?? (foreignKeyFromTable(table.name) as keyof Pivot & string),
        relatedPivotKey:
          relatedPivotKey ?? (foreignKeyFromTable(relatedTable.name) as keyof Pivot & string),
      }),
    );
  }

  async load(...names: string[]): Promise<this> {
    for (const name of names) {
      const method = (this as unknown as Record<string, unknown>)[name];

      if (typeof method !== "function") {
        throw new Error(`${this.constructor.name} has no relation method ${name}().`);
      }

      const relationQuery = method.call(this) as { get: () => Promise<unknown> };
      this.loadedRelations[name] = await relationQuery.get();
    }

    return this;
  }

  loaded<T = unknown>(name: string): T | undefined {
    return this.loadedRelations[name] as T | undefined;
  }

  setLoaded(name: string, value: unknown): this {
    this.loadedRelations[name] = value;
    return this;
  }

  mergeAttributes(patch: Partial<TEntity>): this {
    Object.assign(this.attributes as LoadedAttributes, patch);
    return this;
  }
}

function registerModelRepository<TModelClass>(model: TModelClass, repository: object): TModelClass {
  modelRepositories.set(
    model as object,
    repository as BaseRepository<Record<string, unknown>, "id">,
  );
  ensureBooted(model as object);
  return model;
}

export {
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  HasManyRelationQuery,
  HasOneRelationQuery,
} from "./relationQuery.ts";
export type { CastType, GlobalScopeFn, ModelClassType, ModelConstructor };
export {
  applyCasts,
  dehydrateValue,
  filterMassAssignable,
  hydrateValue,
  Model,
  registerModelRepository,
};
