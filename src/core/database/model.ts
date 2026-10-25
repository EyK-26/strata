import { ConflictError, NotFoundError } from "@getstrata/core/errors/http";
import { onDeferredModelRollback } from "../events/deferredModelEvents.ts";
import type { KeysetOptions } from "../pagination/index.ts";
import BaseRepository from "./baseRepository.ts";
import { foreignKeyFromTable, pivotTableName } from "./inflection.ts";
import {
  applyCasts,
  applyTimestampsOnCreate,
  applyTimestampsOnUpdate,
  type CastType,
  changedAttributes,
  dehydrateValue,
  filterMassAssignable,
  hydrateValue,
  type LoadedAttributes,
  type ModelCasts,
  snapshotAttributes,
} from "./modelAttributes.ts";
import {
  type AnyModel,
  flattenRelationNames,
  loadNested,
  type ModelAttributes,
  type ModelIdentifier,
  type ModelProjection,
  ModelQuery,
  type RelationNameInput,
} from "./modelQuery.ts";
import {
  addModelGlobalScope,
  bindModelRepository,
  ensureBooted,
  findNamedModel,
  type GlobalScopeFn,
  getGlobalScopes,
  type ModelObserver,
  nameModel,
  observeModel,
  registerModelClass,
  registerModelRepositoryFactory,
  resolveModelRepository,
  runObservers,
} from "./modelRegistry.ts";
import { resolveSoftDeleteColumn } from "./query.ts";
import type { AnyRelationQuery, RelatedModelClass } from "./relationQuery.ts";
import {
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  HasManyRelationQuery,
  HasManyThroughRelationQuery,
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
  getByRelationKey,
  hasMany,
  hasManyThrough,
  hasOne,
  indexBelongsToManyRelation,
  morphMany,
  morphOne,
  morphTo,
} from "./relationships.ts";
import type { RepositoryQuery } from "./repositoryQuery.ts";
import type { TableDefinition } from "./table.ts";
import type {
  ModelWhere,
  ModelWriteValues,
  MutationValues,
  QueryOptions,
  QueryWhere,
  UpdateValues,
} from "./types.ts";

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

type RelatedRef<TRelated extends object, RelatedKey extends keyof TRelated & string> =
  | RelatedModelClass<TRelated, RelatedKey>
  | string
  | (() => RelatedModelClass<TRelated, RelatedKey>);

function accessorName(key: string): string {
  const pascal = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return `get${pascal.charAt(0).toUpperCase()}${pascal.slice(1)}Attribute`;
}

/** Retain the declared table as repository() defaults without narrowing legacy explicit calls. */
type DefinedModel<TEntity extends object, PrimaryKey extends keyof TEntity & string> = {
  repository<
    TRecord extends object = TEntity,
    TKey extends keyof TRecord & string = PrimaryKey & keyof TRecord & string,
  >(this: object): BaseRepository<TRecord, TKey>;
} & typeof Model<TEntity, PrimaryKey>;

/** Typed model base with a lazily created framework repository and active connection. */
function defineModel<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
): DefinedModel<TEntity, PrimaryKey> {
  class TableModel extends Model<TEntity, PrimaryKey> {}
  registerModelRepositoryFactory(TableModel, () => new BaseRepository(table));
  return TableModel;
}

/** Register all relationship names before initializing any model's boot hooks. */
function bootModels(models: readonly object[]): void {
  const names = new Map<string, object>();
  for (const model of models) {
    const { name, $morphClass } = model as { name?: string; $morphClass?: string };
    for (const alias of [name, $morphClass]) {
      if (!alias) continue;
      const existing = names.get(alias);
      if (existing && existing !== model) throw new Error(`Duplicate model name [${alias}].`);
      names.set(alias, model);
    }
  }
  for (const model of models) nameModel(model);
  for (const model of models) {
    resolveModelRepository(model);
    ensureBooted(model);
  }
}

function resolveRelated<TRelated extends object, RelatedKey extends keyof TRelated & string>(
  related: RelatedRef<TRelated, RelatedKey>,
): RelatedModelClass<TRelated, RelatedKey> {
  if (typeof related === "string") {
    const found = findNamedModel(related);
    if (!found) {
      throw new Error(`Model [${related}] is not registered. Call registerModelClass() first.`);
    }
    return found as RelatedModelClass<TRelated, RelatedKey>;
  }

  if (
    typeof related === "function" &&
    typeof (related as unknown as RelatedModelClass<TRelated, RelatedKey>).repository !== "function"
  ) {
    return (related as () => RelatedModelClass<TRelated, RelatedKey>)();
  }

  return related as RelatedModelClass<TRelated, RelatedKey>;
}

function inferRelationMethodName(callee: string): string | undefined {
  const stack = new Error().stack ?? "";

  let seenCallee = false;
  for (const line of stack.split("\n")) {
    const match = /at (?:async )?(?:[^.\s]+\.)?(\w+)/.exec(line);
    const name = match?.[1];

    if (!name || name === "Error" || name === "inferRelationMethodName") {
      continue;
    }

    if (!seenCallee) {
      if (name === callee) {
        seenCallee = true;
      }
      continue;
    }

    if (name !== callee) {
      return name;
    }
  }

  return undefined;
}

function morphClassOf(model: object): string {
  const statics = modelStatics(model.constructor === Function ? model : model.constructor);
  return (
    statics.$morphClass ??
    (model.constructor === Function ? (model as { name: string }).name : model.constructor.name)
  );
}

function modelStatics(model: object): typeof Model {
  return model as typeof Model;
}

class Model<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  static $fillable?: readonly string[];
  static $guarded?: readonly string[] | true;
  static $casts: ModelCasts = {};
  static $timestamps = true;
  static $hidden?: readonly string[];
  static $visible?: readonly string[];
  static $appends?: readonly string[];
  static $morphClass?: string;

  private _exists: boolean;
  private originalAttributes: LoadedAttributes;
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
    this.attributes = modelStatics(this.constructor).hydrateAttributes(attributes);
    this.originalAttributes = snapshotAttributes(this.attributes as LoadedAttributes);
  }

  private acceptPersistedAttributes(record: TEntity): void {
    const original = this.originalAttributes;
    const beforeWrite = snapshotAttributes(this.attributes as LoadedAttributes);
    const existed = this._exists;
    this.attributes = modelStatics(this.constructor).hydrateAttributes(record);
    this.originalAttributes = snapshotAttributes(this.attributes as LoadedAttributes);
    const written = this.originalAttributes;
    this._exists = true;
    onDeferredModelRollback(() => {
      // Keep intended edits and subsequent observer/caller edits retryable, but
      // discard fields brought in by RETURNING from a transaction that rolled back.
      this.attributes = {
        ...beforeWrite,
        ...changedAttributes(this.attributes as LoadedAttributes, written),
      } as TEntity;
      this.originalAttributes = original;
      this._exists = existed;
    });
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
    return this.repository.getTable().primaryKey as PrimaryKey;
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
  ): LoadedAttributes | Promise<LoadedAttributes> {
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
    observeModel(this, observer);
  }

  static addGlobalScope<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
    _name: string,
    scope: GlobalScopeFn<TEntity, PrimaryKey>,
  ): void {
    addModelGlobalScope(this, scope);
  }

  static repository<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
  ): BaseRepository<TEntity, PrimaryKey> {
    const repository = resolveModelRepository(this);
    ensureBooted(this);
    return repository as unknown as BaseRepository<TEntity, PrimaryKey>;
  }

  /** Apply this model's global filters to a query with an explicitly selected connection. */
  static scopeQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
    this: object,
    query: RepositoryQuery<TEntity, PrimaryKey>,
  ): RepositoryQuery<TEntity, PrimaryKey> {
    ensureBooted(this);
    let scoped = query as unknown as RepositoryQuery<Record<string, unknown>, "id">;
    for (const scope of getGlobalScopes(this)) scoped = scope(scoped).protectWhere();
    return scoped as unknown as RepositoryQuery<TEntity, PrimaryKey>;
  }

  static query<TModel extends object>(this: { prototype: TModel }): ModelQuery<TModel>;
  static query(this: object): ModelQuery {
    ensureBooted(this);
    const repository = resolveModelRepository(this);
    const scopeQuery = Model.scopeQuery<Record<string, unknown>, "id">;
    return new ModelQuery(this, scopeQuery.call(this, repository.query()));
  }

  static newFromRecord<TModel extends object>(
    this: { prototype: TModel },
    record: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
    exists: false,
  ): TModel;
  static newFromRecord<TModel extends object>(
    this: { prototype: TModel },
    record: NoInfer<ModelAttributes<TModel>>,
    exists?: boolean,
  ): TModel;
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

  /** Trusted SQL/driver/partial-record hydration. Callers own shape and completeness. */
  static newFromTrustedRecord<TModel extends object>(
    this: { prototype: TModel },
    record: object,
    exists?: boolean,
  ): TModel;
  static newFromTrustedRecord(this: object, record: object, exists = true): AnyModel {
    return modelStatics(this).newFromRecord(record, exists);
  }

  static create<TModel extends object>(
    this: { prototype: TModel },
    attributes: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
    forced?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
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
    const payload = await statics.dehydrateAttributes(withTimestamps);
    const pending = statics.newFromRecord({ ...payload }, false) as AnyModel;
    const beforeObservers = snapshotAttributes(pending.attributes);

    if ((await runObservers(pending, "saving")) === false) {
      throw new Error(`${(this as { name: string }).name}.create() was cancelled by an observer.`);
    }

    if ((await runObservers(pending, "creating")) === false) {
      throw new Error(`${(this as { name: string }).name}.create() was cancelled by an observer.`);
    }

    // Keep the established resolved-casts-before-observers contract. Only edits
    // need another write transformation; unchanged values must never be cast
    // twice. Trusted relationship/tenant keys retain their original priority.
    const edits = changedAttributes(pending.attributes, beforeObservers);
    const forcedKeys = new Set(Object.keys(forced));
    for (const key of forcedKeys) delete edits[key];
    let finalPayload = payload;
    if (Object.keys(edits).length > 0) {
      const changed = await statics.dehydrateAttributes(edits);
      // Hook results belong to the extension and may be immutable. Filter and
      // combine into our own payload instead of deleting/assigning its fields.
      const writeEdits = Object.fromEntries(
        Object.entries(changed).filter(([key]) => !forcedKeys.has(key)),
      );
      finalPayload = { ...payload, ...writeEdits };
    }
    const record = await repository.create(finalPayload as MutationValues<object>);
    const created = statics.fromRecord(record, repository, true) as AnyModel;
    await runObservers(created, "created");
    await runObservers(created, "saved");
    return created;
  }

  static with<TModel extends object>(
    this: { prototype: TModel },
    ...relations: RelationNameInput[]
  ): ModelQuery<TModel>;
  static with(this: object, ...relations: RelationNameInput[]): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).with(...relations);
  }

  static withTrashed<TModel extends object>(this: { prototype: TModel }): ModelQuery<TModel>;
  static withTrashed(this: object): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).withTrashed();
  }

  static onlyTrashed<TModel extends object>(this: { prototype: TModel }): ModelQuery<TModel>;
  static onlyTrashed(this: object): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).onlyTrashed();
  }

  static chunk<TModel extends object>(
    this: { prototype: TModel },
    count: number,
    callback: (models: TModel[]) => Promise<boolean | void>,
  ): Promise<void>;
  static async chunk(
    this: object,
    count: number,
    callback: (models: Array<Model<Record<string, unknown>, "id">>) => Promise<boolean | void>,
  ): Promise<void> {
    const statics = modelStatics(this);
    ensureBooted(this);
    await (Model.query as (this: object) => ModelQuery)
      .call(this)
      .query.chunk(count, async (rows) => {
        return await callback(
          rows.map(
            (row) => statics.newFromRecord(row, true) as Model<Record<string, unknown>, "id">,
          ),
        );
      });
  }

  static keysetPaginate<TModel extends object>(
    this: { prototype: TModel },
    options: KeysetOptions<ModelAttributes<TModel>>,
  ) {
    return (Model.query as (this: object) => ModelQuery<TModel>).call(this).keysetPaginate(options);
  }

  static cursorPaginate<TModel extends object>(
    this: { prototype: TModel },
    options: { perPage: number; cursor?: unknown },
  ): Promise<{
    data: TModel[];
    meta: { per_page: number; next_cursor: unknown; prev_cursor: unknown; has_more: boolean };
  }>;
  static async cursorPaginate(
    this: object,
    options: { perPage: number; cursor?: unknown },
  ): Promise<{
    data: Array<Model<Record<string, unknown>, "id">>;
    meta: { per_page: number; next_cursor: unknown; prev_cursor: unknown; has_more: boolean };
  }> {
    const statics = modelStatics(this);
    ensureBooted(this);
    const page = await (Model.query as (this: object) => ModelQuery)
      .call(this)
      .query.cursorPaginate({
        perPage: options.perPage,
        cursor: options.cursor as never,
      });
    return {
      data: page.data.map(
        (row) => statics.newFromRecord(row, true) as Model<Record<string, unknown>, "id">,
      ),
      meta: page.meta,
    };
  }

  static whereHas<TModel extends object>(
    this: { prototype: TModel },
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery<TModel>;
  static whereHas(
    this: object,
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).whereHas(name, constrain);
  }

  static has<TModel extends object>(this: { prototype: TModel }, name: string): ModelQuery<TModel>;
  static has(this: object, name: string): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).has(name);
  }

  static doesntHave<TModel extends object>(
    this: { prototype: TModel },
    name: string,
  ): ModelQuery<TModel>;
  static doesntHave(this: object, name: string): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).doesntHave(name);
  }

  static whereDoesntHave<TModel extends object>(
    this: { prototype: TModel },
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery<TModel>;
  static whereDoesntHave(
    this: object,
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery {
    return (Model.query as (this: object) => ModelQuery)
      .call(this)
      .whereDoesntHave(name, constrain);
  }

  static find<TModel extends object>(
    this: { prototype: TModel },
    id: NoInfer<ModelIdentifier<TModel>>,
  ): Promise<TModel | null>;
  static async find(
    this: object,
    id: unknown,
  ): Promise<Model<Record<string, unknown>, "id"> | null> {
    const primaryKey = resolveModelRepository(this).getTable().primaryKey;
    return (Model.query as (this: object) => ModelQuery)
      .call(this)
      .where({ [primaryKey]: id } as QueryWhere<object>)
      .first();
  }

  static findOrFail<TModel extends object>(
    this: { prototype: TModel },
    id: NoInfer<ModelIdentifier<TModel>>,
    errorFactory?: (id: unknown) => Error,
  ): Promise<TModel>;
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

  static all<TModel extends object>(
    this: { prototype: TModel },
    options?: Omit<QueryOptions<ModelAttributes<TModel>>, "where" | "select">,
  ): Promise<TModel[]>;
  static async all(
    this: object,
    options: Omit<QueryOptions<object>, "where"> = {},
  ): Promise<Array<Model<Record<string, unknown>, "id">>> {
    let query = (Model.query as (this: object) => ModelQuery).call(this);

    if (options.orderBy) {
      query = query.orderBy(options.orderBy);
    }

    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }

    return query.get();
  }

  static where<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
  ): ModelQuery<TModel>;
  static where(this: object, where: QueryWhere<object>): ModelQuery {
    return (Model.query as (this: object) => ModelQuery).call(this).where(where);
  }

  static async count(this: object): Promise<number> {
    return (Model.query as (this: object) => ModelQuery).call(this).count();
  }

  static pluck(this: object, column: string): Promise<unknown[]>;
  static pluck(this: object, column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  static pluck(
    this: object,
    column: string,
    keyBy?: string,
  ): Promise<unknown[] | Map<unknown, unknown>> {
    const query = (Model.query as (this: object) => ModelQuery).call(this);
    return keyBy === undefined ? query.pluck(column) : query.pluck(column, keyBy);
  }

  static value(this: object, column: string): Promise<unknown> {
    return (Model.query as (this: object) => ModelQuery).call(this).value(column);
  }

  static firstWhere<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    options?: Omit<QueryOptions<ModelAttributes<TModel>>, "where" | "select">,
  ): Promise<TModel | null>;
  static async firstWhere(
    this: object,
    where: QueryWhere<object>,
    options: Omit<QueryOptions<object>, "where"> = {},
  ): Promise<Model<Record<string, unknown>, "id"> | null> {
    let query = (Model.query as (this: object) => ModelQuery).call(this).where(where);

    if (options.orderBy) {
      query = query.orderBy(options.orderBy);
    }

    return query.first();
  }

  static firstOrNew<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    values?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
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

  static firstOrCreate<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    values?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
  static async firstOrCreate(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    const findExisting = () =>
      (
        Model.firstWhere as (
          this: object,
          filter: QueryWhere<object>,
        ) => Promise<Model<Record<string, unknown>, "id"> | null>
      ).call(this, where);

    const existing = await findExisting();

    if (existing) {
      return existing;
    }

    try {
      return await (
        Model.create as (
          this: object,
          attributes: Record<string, unknown>,
        ) => Promise<Model<Record<string, unknown>, "id">>
      ).call(this, { ...where, ...values });
    } catch (error) {
      if (!(error instanceof ConflictError)) {
        throw error;
      }

      const raced = await findExisting();

      if (!raced) {
        throw error;
      }

      return raced;
    }
  }

  static updateOrCreate<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    values?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
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
    const table = this.repository.getTable();
    const updating = this.$exists;

    if ((await runObservers(this as never, "saving")) === false) {
      return this;
    }

    if ((await runObservers(this as never, updating ? "updating" : "creating")) === false) {
      return this;
    }

    if (updating) {
      const dirty = changedAttributes(this.attributes as LoadedAttributes, this.originalAttributes);
      if (Object.keys(dirty).length === 0) {
        await runObservers(this as never, "saved");
        return this;
      }
      const changes = applyTimestampsOnUpdate(
        table.columns,
        await ModelClass.dehydrateAttributes(dirty),
        timestamps,
      ) as UpdateValues<TEntity, PrimaryKey>;
      const record = await this.repository.updateByIdOrThrow(this.id, changes);
      this.acceptPersistedAttributes(record);
      await runObservers(this as never, "updated");
      await runObservers(this as never, "saved");
      return this;
    }

    const assignable = filterMassAssignable(
      ModelClass.$fillable,
      ModelClass.$guarded,
      this.attributes as LoadedAttributes,
    );
    const withTimestamps = applyTimestampsOnCreate(table.columns, assignable, timestamps);
    const payload = (await ModelClass.dehydrateAttributes(
      withTimestamps,
    )) as MutationValues<TEntity>;
    const record = await this.repository.create(payload);
    this.acceptPersistedAttributes(record);
    await runObservers(this as never, "created");
    await runObservers(this as never, "saved");
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
    const record = await this.repository.restoreById(this.id);

    if (!record) {
      return null;
    }

    this.acceptPersistedAttributes(record);
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
    const loaded = getByRelationKey(grouped, this.attributes[relation.localKey]) ?? [];
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
    const loaded = getByRelationKey(grouped, this.attributes[relation.foreignKey as keyof TEntity]);
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
    const loaded = getByRelationKey(grouped, parentId) ?? [];
    return Object.assign(this, { [as]: loaded }) as this & Record<Alias, TRelated[]>;
  }

  hasMany<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedRef<TRelated, RelatedKey>,
    foreignKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
  ): HasManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(related);
    return new HasManyRelationQuery(
      this,
      relatedClass,
      hasMany({
        name: relatedClass.repository().getTable().name,
        localKey: localKey ?? table.primaryKey,
        foreignKey: foreignKey ?? (foreignKeyFromTable(table.name) as keyof TRelated & string),
      }),
    );
  }

  hasOne<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedRef<TRelated, RelatedKey>,
    foreignKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
  ): HasOneRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(related);
    return new HasOneRelationQuery(
      this,
      relatedClass,
      hasOne({
        name: relatedClass.repository().getTable().name,
        localKey: localKey ?? table.primaryKey,
        foreignKey: foreignKey ?? (foreignKeyFromTable(table.name) as keyof TRelated & string),
      }),
    );
  }

  belongsTo<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedRef<TRelated, RelatedKey>,
    foreignKey?: keyof TEntity & string,
    ownerKey?: RelatedKey,
  ): BelongsToRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const relatedClass = resolveRelated(related);
    const relatedTable = relatedClass.repository().getTable();
    return new BelongsToRelationQuery(
      this,
      relatedClass,
      belongsTo({
        name: relatedTable.name,
        foreignKey:
          foreignKey ?? (foreignKeyFromTable(relatedTable.name) as keyof TEntity & string),
        ownerKey: ownerKey ?? relatedTable.primaryKey,
      }),
    );
  }

  hasManyThrough<
    TRelated extends object,
    TThrough extends object,
    RelatedKey extends keyof TRelated & string,
    ThroughKey extends keyof TThrough & string,
  >(
    related: RelatedRef<TRelated, RelatedKey>,
    through: RelatedRef<TThrough, ThroughKey>,
    firstKey?: string,
    secondKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
    secondLocalKey?: ThroughKey,
  ): HasManyThroughRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(related);
    const throughClass = resolveRelated(through);
    const throughTable = throughClass.repository().getTable();
    return new HasManyThroughRelationQuery(
      this,
      relatedClass,
      hasManyThrough({
        name: relatedClass.repository().getTable().name,
        throughTable: throughTable.name,
        localKey: localKey ?? table.primaryKey,
        firstKey: firstKey ?? (foreignKeyFromTable(table.name) as string),
        secondLocalKey: (secondLocalKey ?? throughTable.primaryKey) as ThroughKey,
        secondKey: secondKey ?? (foreignKeyFromTable(throughTable.name) as keyof TRelated & string),
      }),
    );
  }

  belongsToMany<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    Pivot extends object = Record<string, unknown>,
  >(
    related: RelatedRef<TRelated, RelatedKey>,
    pivotTable?: string,
    foreignPivotKey?: keyof Pivot & string,
    relatedPivotKey?: keyof Pivot & string,
  ): BelongsToManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey, Pivot> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(related);
    const relatedTable = relatedClass.repository().getTable();
    return new BelongsToManyRelationQuery(
      this,
      relatedClass,
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
    related: RelatedRef<TRelated, RelatedKey>,
    morphName: string,
    typeKey?: keyof TRelated & string,
    idKey?: keyof TRelated & string,
    morphType?: string,
  ): MorphManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(related);
    return new MorphManyRelationQuery(
      this,
      relatedClass,
      morphMany({
        name: morphName,
        localKey: table.primaryKey,
        morphTypeKey: typeKey ?? (`${morphName}_type` as keyof TRelated & string),
        morphIdKey: idKey ?? (`${morphName}_id` as keyof TRelated & string),
        morphType: morphType ?? morphClassOf(this),
      }),
    );
  }

  morphOne<TRelated extends object, RelatedKey extends keyof TRelated & string>(
    related: RelatedRef<TRelated, RelatedKey>,
    morphName: string,
    typeKey?: keyof TRelated & string,
    idKey?: keyof TRelated & string,
    morphType?: string,
  ): MorphOneRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(related);
    return new MorphOneRelationQuery(
      this,
      relatedClass,
      morphOne({
        name: morphName,
        localKey: table.primaryKey,
        morphTypeKey: typeKey ?? (`${morphName}_type` as keyof TRelated & string),
        morphIdKey: idKey ?? (`${morphName}_id` as keyof TRelated & string),
        morphType: morphType ?? morphClassOf(this),
      }),
    );
  }

  morphTo(
    relatedByType: Record<string, RelatedRef<Record<string, unknown>, "id">>,
    morphName?: string,
    typeKey?: keyof TEntity & string,
    idKey?: keyof TEntity & string,
  ): MorphToRelationQuery<TEntity, PrimaryKey> {
    const resolvedName = morphName ?? inferRelationMethodName("morphTo");

    if (!resolvedName) {
      throw new Error(
        `${this.constructor.name}.morphTo() needs an explicit morph name (the calling method name is not available at runtime).`,
      );
    }

    const resolvedMap = Object.fromEntries(
      Object.entries(relatedByType).map(([type, related]) => [type, resolveRelated(related)]),
    ) as Record<string, RelatedModelClass<Record<string, unknown>, "id">>;

    return new MorphToRelationQuery(
      this,
      resolvedMap,
      morphTo({
        name: resolvedName,
        morphTypeKey: typeKey ?? (`${resolvedName}_type` as keyof TEntity & string),
        morphIdKey: idKey ?? (`${resolvedName}_id` as keyof TEntity & string),
      }),
    );
  }

  async load(...names: RelationNameInput[]): Promise<this> {
    for (const name of flattenRelationNames(names)) {
      if (name.includes(".")) {
        await loadNested(this as never, name);
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

/** Binds a Model class to its table/connection and names it for `hasMany("User")`. */
function registerModelRepository<TModelClass>(model: TModelClass, repository: object): TModelClass {
  bindModelRepository(model as object, repository as BaseRepository<Record<string, unknown>, "id">);
  nameModel(model as object);
  ensureBooted(model as object);
  return model;
}

export {
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  HasManyRelationQuery,
  HasManyThroughRelationQuery,
  HasOneRelationQuery,
  MorphManyRelationQuery,
  MorphOneRelationQuery,
  MorphToRelationQuery,
} from "./relationQuery.ts";
export type {
  CastType,
  GlobalScopeFn,
  ModelAttributes,
  ModelClassType,
  ModelConstructor,
  ModelProjection,
};
export {
  applyCasts,
  bootModels,
  defineModel,
  dehydrateValue,
  filterMassAssignable,
  hydrateValue,
  Model,
  ModelQuery,
  registerModelClass,
  registerModelRepository,
};
