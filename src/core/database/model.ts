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
  MorphManyRelationQuery,
  MorphOneRelationQuery,
  MorphToRelationQuery,
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
  morphMany,
  morphOne,
  morphTo,
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
const modelObservers = new WeakMap<object, ModelObserver[]>();
const modelBooted = new WeakSet<object>();

type AnyModel = Model<Record<string, unknown>, "id">;

type ModelObserver = {
  creating?: (model: AnyModel) => unknown;
  created?: (model: AnyModel) => unknown;
  updating?: (model: AnyModel) => unknown;
  updated?: (model: AnyModel) => unknown;
  deleting?: (model: AnyModel) => unknown;
  deleted?: (model: AnyModel) => unknown;
};

async function runObservers(model: AnyModel, hook: keyof ModelObserver): Promise<boolean> {
  const observers = modelObservers.get(model.constructor) ?? [];

  for (const observer of observers) {
    const handler = observer[hook];

    if (handler && (await handler(model)) === false) {
      return false;
    }
  }

  return true;
}

function accessorName(key: string): string {
  const pascal = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return `get${pascal.charAt(0).toUpperCase()}${pascal.slice(1)}Attribute`;
}

function constrainRelationExists(
  model: object,
  name: string,
  constrain: ((query: AnyRelationQuery) => void) | undefined,
  not: boolean,
): RepositoryQuery<Record<string, unknown>, "id"> {
  const statics = modelStatics(model);
  ensureBooted(model);
  const repository = resolveModelRepository(model);
  const dummy = statics.newFromRecord({});
  const method = (dummy as unknown as Record<string, unknown>)[name];

  if (typeof method !== "function") {
    throw new Error(`${(model as { name: string }).name} has no relation method ${name}().`);
  }

  const relationQuery = method.call(dummy) as AnyRelationQuery;
  constrain?.(relationQuery);
  const exists = relationQuery.toExistsClause(repository.getTable().name);
  const query = (
    Model.query as (this: object) => RepositoryQuery<Record<string, unknown>, "id">
  ).call(model);
  return not
    ? query.whereNotExists(exists.sql, exists.params)
    : query.whereExists(exists.sql, exists.params);
}

async function loadNested(
  model: { load: (...names: string[]) => Promise<unknown>; loaded: (name: string) => unknown },
  path: string,
): Promise<void> {
  const [head, ...rest] = path.split(".");

  if (!head) {
    return;
  }

  await model.load(head);

  if (rest.length === 0) {
    return;
  }

  const loaded = model.loaded(head);
  const children = Array.isArray(loaded) ? loaded : loaded ? [loaded] : [];

  for (const child of children) {
    if (
      child &&
      typeof child === "object" &&
      typeof (child as { load?: unknown }).load === "function"
    ) {
      await loadNested(
        child as {
          load: (...names: string[]) => Promise<unknown>;
          loaded: (name: string) => unknown;
        },
        rest.join("."),
      );
    }
  }
}

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
  static $hidden?: readonly string[];
  static $visible?: readonly string[];
  static $appends?: readonly string[];

  private _exists: boolean;
  private readonly loadedRelations: Record<string, unknown> = {};
  private hiddenOverrides: string[] = [];
  private visibleOverrides: string[] = [];
  private appended: string[] = [];

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

  toArray(): Record<string, unknown> {
    const ModelClass = modelStatics(this.constructor);
    const hidden = new Set([...(ModelClass.$hidden ?? []), ...this.hiddenOverrides]);
    const visible = this.visibleOverrides.length > 0 ? this.visibleOverrides : ModelClass.$visible;
    const data: Record<string, unknown> = { ...(this.attributes as LoadedAttributes) };

    if (visible && visible.length > 0) {
      for (const key of Object.keys(data)) {
        if (!visible.includes(key)) {
          delete data[key];
        }
      }
    }

    for (const key of hidden) {
      delete data[key];
    }

    for (const key of [...(ModelClass.$appends ?? []), ...this.appended]) {
      const accessor = (this as unknown as Record<string, unknown>)[accessorName(key)];
      if (typeof accessor === "function") {
        data[key] = (accessor as () => unknown).call(this);
      }
    }

    for (const [name, value] of Object.entries(this.loadedRelations)) {
      if (
        !hidden.has(name) &&
        (!visible || visible.includes(name) || this.appended.includes(name))
      ) {
        data[name] = value;
      }
    }

    return data;
  }

  toJSON(): Record<string, unknown> {
    return this.toArray();
  }

  makeHidden(...keys: string[]): this {
    this.hiddenOverrides.push(...keys);
    return this;
  }

  makeVisible(...keys: string[]): this {
    this.visibleOverrides.push(...keys);
    return this;
  }

  append(...keys: string[]): this {
    this.appended.push(...keys);
    return this;
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

  static observe(this: object, observer: ModelObserver): void {
    const existing = modelObservers.get(this) ?? [];
    modelObservers.set(this, [...existing, observer]);
  }

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
    const pending = statics.newFromRecord({ ...payload }, false) as AnyModel;

    if ((await runObservers(pending, "creating")) === false) {
      throw new Error(`${(this as { name: string }).name}.create() was cancelled by an observer.`);
    }

    const record = await repository.create(payload as MutationValues<object>);
    const created = statics.fromRecord(record, repository, true) as AnyModel;
    await runObservers(created, "created");
    return created;
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
    const resolved = relations.map((path) => {
      const name = path.split(".")[0] ?? path;
      const method = (dummy as unknown as Record<string, unknown>)[name];

      if (typeof method !== "function") {
        throw new Error(`${(this as { name: string }).name} has no relation method ${name}().`);
      }

      const relationQuery = method.call(dummy) as AnyRelationQuery;
      return { name, path, relationQuery };
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

          for (const { name, path, relationQuery } of resolved) {
            if (relationQuery.kind === "belongsToMany") {
              await model.load(path.includes(".") ? path : name);
              continue;
            }

            model.setLoaded(name, relationQuery.hydrateEager(row, name));
            const nested = path.split(".").slice(1).join(".");

            if (nested) {
              await loadNested(model, path);
            }
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

  static whereHas(
    this: object,
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): RepositoryQuery<Record<string, unknown>, "id"> {
    return constrainRelationExists(this, name, constrain, false);
  }

  static has(this: object, name: string): RepositoryQuery<Record<string, unknown>, "id"> {
    return constrainRelationExists(this, name, undefined, false);
  }

  static doesntHave(this: object, name: string): RepositoryQuery<Record<string, unknown>, "id"> {
    return constrainRelationExists(this, name, undefined, true);
  }

  static whereDoesntHave(
    this: object,
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): RepositoryQuery<Record<string, unknown>, "id"> {
    return constrainRelationExists(this, name, constrain, true);
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

  static where(
    this: object,
    where: QueryWhere<object>,
  ): RepositoryQuery<Record<string, unknown>, "id"> {
    return (Model.query as (this: object) => RepositoryQuery<Record<string, unknown>, "id">)
      .call(this)
      .where(where);
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

  static async firstOrNew(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    const existing = await (
      Model.firstWhere as (
        this: object,
        filter: QueryWhere<object>,
      ) => Promise<Model<Record<string, unknown>, "id"> | null>
    ).call(this, where);

    if (existing) {
      return existing;
    }

    return modelStatics(this).newFromRecord({ ...where, ...values }, false);
  }

  static async firstOrCreate(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    const existing = await (
      Model.firstWhere as (
        this: object,
        filter: QueryWhere<object>,
      ) => Promise<Model<Record<string, unknown>, "id"> | null>
    ).call(this, where);

    if (existing) {
      return existing;
    }

    return (
      Model.create as (
        this: object,
        attributes: Record<string, unknown>,
      ) => Promise<Model<Record<string, unknown>, "id">>
    ).call(this, { ...where, ...values });
  }

  static async updateOrCreate(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    const existing = await (
      Model.firstWhere as (
        this: object,
        filter: QueryWhere<object>,
      ) => Promise<Model<Record<string, unknown>, "id"> | null>
    ).call(this, where);

    if (existing) {
      return existing.update(values);
    }

    return (
      Model.create as (
        this: object,
        attributes: Record<string, unknown>,
      ) => Promise<Model<Record<string, unknown>, "id">>
    ).call(this, { ...where, ...values });
  }

  async save(): Promise<this> {
    const ModelClass = modelStatics(this.constructor);
    const timestamps = ModelClass.$timestamps ?? true;
    const casts = ModelClass.$casts ?? {};
    const table = this.repository.getTable();
    const updating = this.$exists;

    if ((await runObservers(this as never, updating ? "updating" : "creating")) === false) {
      return this;
    }

    if (updating) {
      const changes = applyTimestampsOnUpdate(
        table.columns,
        applyCasts(this.attributes as LoadedAttributes, casts, "dehydrate"),
        timestamps,
      ) as UpdateValues<TEntity, PrimaryKey>;
      const record = await this.repository.updateByIdOrThrow(this.id, changes);
      this.attributes = ModelClass.hydrateAttributes(record);
      await runObservers(this as never, "updated");
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
    await runObservers(this as never, "created");
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
    if ((await runObservers(this as never, "deleting")) === false) {
      return false;
    }

    const deleted = resolveSoftDeleteColumn(this.repository.getTable())
      ? await this.repository.deleteById(this.id)
      : await this.repository.forceDeleteById(this.id);

    if (deleted) {
      await runObservers(this as never, "deleted");
    }

    return deleted;
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

  morphMany<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedModelClass<TRelated, RelatedKey>,
    morphName: string,
    typeKey?: keyof TRelated & string,
    idKey?: keyof TRelated & string,
  ): MorphManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    return new MorphManyRelationQuery(
      this,
      related,
      morphMany({
        name: morphName,
        localKey: table.primaryKey,
        morphTypeKey: typeKey ?? (`${morphName}_type` as keyof TRelated & string),
        morphIdKey: idKey ?? (`${morphName}_id` as keyof TRelated & string),
        morphType: table.name,
      }),
    );
  }

  morphOne<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedModelClass<TRelated, RelatedKey>,
    morphName: string,
    typeKey?: keyof TRelated & string,
    idKey?: keyof TRelated & string,
  ): MorphOneRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    return new MorphOneRelationQuery(
      this,
      related,
      morphOne({
        name: morphName,
        localKey: table.primaryKey,
        morphTypeKey: typeKey ?? (`${morphName}_type` as keyof TRelated & string),
        morphIdKey: idKey ?? (`${morphName}_id` as keyof TRelated & string),
        morphType: table.name,
      }),
    );
  }

  morphTo(
    relatedByType: Record<string, RelatedModelClass<Record<string, unknown>, "id">>,
    morphName = "imageable",
    typeKey?: keyof TEntity & string,
    idKey?: keyof TEntity & string,
  ): MorphToRelationQuery<TEntity, PrimaryKey> {
    return new MorphToRelationQuery(
      this,
      relatedByType,
      morphTo({
        name: morphName,
        morphTypeKey: typeKey ?? (`${morphName}_type` as keyof TEntity & string),
        morphIdKey: idKey ?? (`${morphName}_id` as keyof TEntity & string),
      }),
    );
  }

  async load(...names: string[]): Promise<this> {
    for (const name of names) {
      if (name.includes(".")) {
        await loadNested(this, name);
        continue;
      }

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
  MorphManyRelationQuery,
  MorphOneRelationQuery,
  MorphToRelationQuery,
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
