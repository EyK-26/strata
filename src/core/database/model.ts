import { isDeepStrictEqual } from "node:util";
import { ConflictError, NotFoundError } from "@getstrata/core/errors/http";
import { hashPassword } from "../auth/password.ts";
import { onDeferredModelRollback } from "../events/deferredModelEvents.ts";
import type { CursorPaginatedResult, KeysetCursor, KeysetOptions } from "../pagination/index.ts";
import BaseRepository from "./baseRepository.ts";
import { foreignKeyFromTable, pivotTableName } from "./inflection.ts";
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
  QueryLockOptions,
  QueryOptions,
  QueryWhere,
  UpdateValues,
} from "./types.ts";

type CastType = "date" | "datetime" | "json" | "bool" | "boolean" | "integer" | "int" | "hashed";
type LoadedAttributes = Record<string, unknown>;
type ModelCasts = Partial<Record<string, CastType>>;

function snapshotAttributes(values: LoadedAttributes): LoadedAttributes {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      Buffer.isBuffer(value) ? Buffer.from(value) : structuredClone(value),
    ]),
  );
}

function changedAttributes(values: LoadedAttributes, original: LoadedAttributes): LoadedAttributes {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !(key in original) || !isDeepStrictEqual(value, original[key]),
    ),
  );
}

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
const modelRepositoryFactories = new WeakMap<object, () => object>();
const namedModels = new Map<string, object>();
const modelGlobalScopes = new WeakMap<object, GlobalScopeFn<Record<string, unknown>, "id">[]>();
const modelObservers = new WeakMap<object, ModelObserver[]>();
const modelBooted = new WeakSet<object>();

type AnyModel = Model<Record<string, unknown>, "id">;
type ModelAttributes<TModel> = TModel extends { toObject(): infer TRecord extends object }
  ? TRecord
  : Record<string, unknown>;
type ModelIdentifier<TModel> = TModel extends { readonly id: infer TKey } ? TKey : unknown;
type WithModelCount<TModel, TCount extends string> = {
  toObject(): Omit<ModelAttributes<TModel>, TCount> & Record<TCount, unknown>;
  get<K extends keyof (Omit<ModelAttributes<TModel>, TCount> & Record<TCount, unknown>)>(
    key: K,
  ): (Omit<ModelAttributes<TModel>, TCount> & Record<TCount, unknown>)[K];
} & TModel;

type ModelQueryResult<TModel, TCounts extends string> = [TCounts] extends [never]
  ? TModel
  : WithModelCount<TModel, TCounts>;

type RelatedRef<TRelated extends object, RelatedKey extends keyof TRelated & string> =
  | RelatedModelClass<TRelated, RelatedKey>
  | string
  | (() => RelatedModelClass<TRelated, RelatedKey>);

type RelationNameInput = string | readonly string[];

function flattenRelationNames(relations: ReadonlyArray<RelationNameInput>): string[] {
  const names: string[] = [];

  for (const item of relations) {
    if (typeof item === "string") {
      if (item.length > 0) {
        names.push(item);
      }
      continue;
    }

    if (Array.isArray(item)) {
      for (const nested of item) {
        if (typeof nested === "string" && nested.length > 0) {
          names.push(nested);
        }
      }
    }
  }

  return names;
}

type ModelObserver = {
  retrieved?: (model: AnyModel) => unknown;
  creating?: (model: AnyModel) => unknown;
  created?: (model: AnyModel) => unknown;
  updating?: (model: AnyModel) => unknown;
  updated?: (model: AnyModel) => unknown;
  saving?: (model: AnyModel) => unknown;
  saved?: (model: AnyModel) => unknown;
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

function isLoadableModel(value: unknown): value is {
  load: (...names: string[]) => Promise<unknown>;
  loaded: (name: string) => unknown;
  constructor: object;
  getRepository: () => BaseRepository<Record<string, unknown>, "id">;
  toObject: () => object;
  setLoaded: (name: string, value: unknown) => unknown;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { load?: unknown }).load === "function" &&
      typeof (value as { loaded?: unknown }).loaded === "function" &&
      typeof (value as { setLoaded?: unknown }).setLoaded === "function",
  );
}

async function eagerLoadOnModels(
  models: Array<{
    loaded: (name: string) => unknown;
    constructor: object;
    getRepository: () => BaseRepository<Record<string, unknown>, "id">;
    toObject: () => object;
    setLoaded: (name: string, value: unknown) => unknown;
    load: (...names: string[]) => Promise<unknown>;
  }>,
  paths: string[],
): Promise<void> {
  if (models.length === 0 || paths.length === 0) {
    return;
  }

  const grouped = new Map<string, string[]>();

  for (const path of paths) {
    const [head, ...rest] = path.split(".");
    if (!head) {
      continue;
    }
    const nested = rest.join(".");
    const existing = grouped.get(head) ?? [];
    if (nested) {
      existing.push(nested);
    }
    grouped.set(head, existing);
  }

  await Promise.all(
    [...grouped.entries()].map(async ([head, nested]) => {
      const unloaded = models.filter((model) => model.loaded(head) === undefined);

      if (unloaded.length > 0) {
        const first = unloaded[0];
        if (!first) {
          return;
        }
        const method = (first as unknown as Record<string, unknown>)[head];

        if (typeof method !== "function") {
          throw new Error(
            `${(first.constructor as { name: string }).name} has no relation method ${head}().`,
          );
        }

        const relationQuery = method.call(first) as AnyRelationQuery;
        const query = first.getRepository().query();
        relationQuery.applyEagerLoad(query, head);
        const attached = await query.attachToRows(
          unloaded.map((model) => model.toObject() as Record<string, unknown>),
        );

        for (const [index, model] of unloaded.entries()) {
          const row = attached[index] ?? model.toObject();
          model.setLoaded(head, relationQuery.hydrateEager(row as Record<string, unknown>, head));
        }
      }

      if (nested.length === 0) {
        return;
      }

      const children = models.flatMap((model) => {
        const loaded = model.loaded(head);
        return Array.isArray(loaded) ? loaded : loaded ? [loaded] : [];
      });
      await eagerLoadOnModels(children.filter(isLoadableModel), nested);
    }),
  );
}

async function loadNested(
  model: {
    load: (...names: string[]) => Promise<unknown>;
    loaded: (name: string) => unknown;
    constructor: object;
    getRepository: () => BaseRepository<Record<string, unknown>, "id">;
    toObject: () => object;
    setLoaded: (name: string, value: unknown) => unknown;
  },
  path: string,
): Promise<void> {
  await eagerLoadOnModels([model], [path]);
}

function nameModel(model: object): void {
  const { name, $morphClass } = model as { name?: string; $morphClass?: string };
  if (name) namedModels.set(name, model);
  if ($morphClass) namedModels.set($morphClass, model);
}

function resolveModelRepository(model: object): BaseRepository<Record<string, unknown>, "id"> {
  const existing = modelRepositories.get(model);
  if (existing) return existing;

  // Inherit the definition, but cache a separate repository for each concrete class.
  for (let current: object | null = model; current; current = Object.getPrototypeOf(current)) {
    const factory = modelRepositoryFactories.get(current);
    if (!factory) continue;
    const repository = factory() as BaseRepository<Record<string, unknown>, "id">;
    modelRepositories.set(model, repository);
    nameModel(model);
    return repository;
  }
  throw new Error(`${(model as { name: string }).name}.repository() is not implemented.`);
}

/** Typed model base with a lazily created framework repository and active connection. */
function defineModel<TEntity extends object, PrimaryKey extends keyof TEntity & string>(
  table: TableDefinition<TEntity, PrimaryKey>,
): typeof Model<TEntity, PrimaryKey> {
  class TableModel extends Model<TEntity, PrimaryKey> {}
  modelRepositoryFactories.set(TableModel, () => new BaseRepository(table));
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

/** Alias for `hasMany("Name")` when `Name` is not `constructor.name` or `$morphClass`. */
function registerModelClass(name: string, model: object): void {
  namedModels.set(name, model);
}

function resolveRelated<TRelated extends object, RelatedKey extends keyof TRelated & string>(
  related: RelatedRef<TRelated, RelatedKey>,
): RelatedModelClass<TRelated, RelatedKey> {
  if (typeof related === "string") {
    const found = namedModels.get(related);
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

function ensureBooted(model: object): void {
  if (modelBooted.has(model)) {
    return;
  }

  nameModel(model);
  modelBooted.add(model);

  const scopes = modelGlobalScopes.get(model);
  const observers = modelObservers.get(model);
  const boot = (model as { boot?: () => void }).boot;

  if (typeof boot === "function") {
    try {
      boot.call(model);
    } catch (error) {
      modelBooted.delete(model);
      if (scopes) modelGlobalScopes.set(model, scopes);
      else modelGlobalScopes.delete(model);
      if (observers) modelObservers.set(model, observers);
      else modelObservers.delete(model);
      throw error;
    }
  }
}

function getGlobalScopes(model: object): GlobalScopeFn<Record<string, unknown>, "id">[] {
  return modelGlobalScopes.get(model) ?? [];
}

const PASSWORD_HASH_PATTERN = /^\$(?:2[aby]?|argon2(?:i|d|id)?)\$/;

function isAlreadyHashed(value: string): boolean {
  return PASSWORD_HASH_PATTERN.test(value);
}

async function hashCastValue(value: unknown): Promise<unknown> {
  if (value === null || value === undefined) return value;
  const plain = String(value);

  if (isAlreadyHashed(plain)) {
    return plain;
  }

  return await hashPassword(plain);
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
    case "integer":
    case "int":
      return value === "" ? null : Number(value);
    case "hashed":
      return value;
    default:
      return value;
  }
}

function dehydrateValue(value: unknown, cast: "hashed"): Promise<unknown>;
function dehydrateValue(value: unknown, cast: Exclude<CastType, "hashed">): unknown;
function dehydrateValue(value: unknown, cast: CastType): unknown;
function dehydrateValue(value: unknown, cast: CastType): unknown {
  if (cast === "hashed") return hashCastValue(value);
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
    case "integer":
    case "int":
      return value === "" ? null : Number(value);
    default:
      return value;
  }
}

function filterMassAssignable(
  fillable: readonly string[] | undefined,
  guarded: readonly string[] | true | undefined,
  input: LoadedAttributes,
): LoadedAttributes {
  if (fillable === undefined && guarded === undefined && Object.keys(input).length > 0) {
    throw new Error(
      "Mass assignment is not configured for this model. Declare static $fillable = [...] to allow specific columns, or static $guarded = [] to allow all of them.",
    );
  }

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
  direction: "hydrate",
): LoadedAttributes;
function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "dehydrate",
): Promise<LoadedAttributes>;
function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "hydrate" | "dehydrate",
): LoadedAttributes | Promise<LoadedAttributes>;
function applyCasts(
  values: LoadedAttributes,
  casts: ModelCasts,
  direction: "hydrate" | "dehydrate",
): LoadedAttributes | Promise<LoadedAttributes> {
  const entries = Object.entries(casts);
  if (entries.length === 0) {
    return direction === "hydrate" ? values : Promise.resolve(values);
  }

  const result = { ...values };
  if (direction === "hydrate") {
    for (const [key, cast] of entries) {
      if (key in result && cast) result[key] = hydrateValue(result[key], cast);
    }
    return result;
  }

  return (async () => {
    for (const [key, cast] of entries) {
      if (key in result && cast) result[key] = await dehydrateValue(result[key], cast);
    }
    return result;
  })();
}

function castPluckedValue(modelClass: object, column: string, value: unknown): unknown {
  const cast = modelStatics(modelClass).$casts?.[column];
  return cast ? hydrateValue(value, cast) : value;
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

/** Read-only plain records; partial selection never acquires model mutation methods. */
class ModelProjection<TEntity extends object, K extends keyof TEntity & string> {
  constructor(
    private readonly load: (limit?: number) => Promise<Array<Pick<TEntity, K>>>,
    private readonly page: (
      options: KeysetOptions<TEntity>,
    ) => Promise<CursorPaginatedResult<Pick<TEntity, K>, KeysetCursor>>,
  ) {}
  keysetPaginate(options: KeysetOptions<TEntity>) {
    return this.page(options);
  }
  get(): Promise<Array<Pick<TEntity, K>>> {
    return this.load();
  }
  async first(): Promise<Pick<TEntity, K> | null> {
    return (await this.load(1))[0] ?? null;
  }
}

class ModelQuery<TModel extends object = AnyModel, TCounts extends string = never> {
  private readonly eager: Array<{ name: string; path: string; relationQuery: AnyRelationQuery }> =
    [];

  constructor(
    private readonly modelClass: object,
    readonly query: RepositoryQuery<Record<string, unknown>, "id">,
  ) {}

  with(...relations: RelationNameInput[]): this {
    const statics = modelStatics(this.modelClass);
    ensureBooted(this.modelClass);
    const dummy = statics.newFromRecord({}, false);

    for (const path of flattenRelationNames(relations)) {
      const name = path.split(".")[0] ?? path;
      const method = (dummy as unknown as Record<string, unknown>)[name];

      if (typeof method !== "function") {
        throw new Error(
          `${(this.modelClass as { name: string }).name} has no relation method ${name}().`,
        );
      }

      const relationQuery = method.call(dummy) as AnyRelationQuery;
      this.eager.push({ name, path, relationQuery });
      relationQuery.applyEagerLoad(this.query, name);
    }

    return this;
  }

  where(
    input:
      | ModelWhere<ModelAttributes<TModel>>
      | ((
          builder: import("./whereBuilder.ts").WhereBuilder<
            ModelAttributes<TModel>,
            ModelWhere<ModelAttributes<TModel>>
          >,
        ) => void),
  ): this {
    this.query.where(input as never);
    return this;
  }

  orWhere(
    input:
      | ModelWhere<ModelAttributes<TModel>>
      | ((
          builder: import("./whereBuilder.ts").WhereBuilder<
            ModelAttributes<TModel>,
            ModelWhere<ModelAttributes<TModel>>
          >,
        ) => void),
  ): this {
    this.query.orWhere(input as never);
    return this;
  }

  /** Qualified/dynamic filters retain existing SQL semantics through an explicit escape hatch. */
  whereDynamic(input: QueryWhere<object>): this {
    this.query.where(input as never);
    return this;
  }

  select<K extends keyof ModelAttributes<TModel> & string>(
    ...columns: readonly K[]
  ): ModelProjection<ModelAttributes<TModel>, K> {
    return new ModelProjection(
      async (limit) => {
        const rows = await this.query.project(columns, limit);
        return rows.map(
          (row) =>
            applyCasts(row, modelStatics(this.modelClass).$casts, "hydrate") as Pick<
              ModelAttributes<TModel>,
              K
            >,
        );
      },
      async (options) => {
        const page = await this.query.projectKeyset(columns, options as never);
        return {
          ...page,
          data: page.data.map(
            (row) =>
              applyCasts(row, modelStatics(this.modelClass).$casts, "hydrate") as Pick<
                ModelAttributes<TModel>,
                K
              >,
          ),
        };
      },
    );
  }

  lockForUpdate(options: QueryLockOptions = {}): this {
    this.query.lockForUpdate(options);
    return this;
  }

  sharedLock(options: QueryLockOptions = {}): this {
    this.query.sharedLock(options);
    return this;
  }

  orderBy(orderBy: QueryOptions<ModelAttributes<TModel>>["orderBy"]): this {
    this.query.orderBy(orderBy as never);
    return this;
  }

  limit(limit: number): this {
    this.query.limit(limit);
    return this;
  }

  offset(offset: number): this {
    this.query.offset(offset);
    return this;
  }

  whereNull(column: keyof ModelAttributes<TModel> & string): this {
    this.query.whereNull(column);
    return this;
  }

  whereNotNull(column: keyof ModelAttributes<TModel> & string): this {
    this.query.whereNotNull(column as never);
    return this;
  }

  whereIn<K extends keyof ModelAttributes<TModel> & string>(
    column: K,
    values: readonly ModelAttributes<TModel>[K][],
  ): this {
    this.query.whereIn(column, values);
    return this;
  }

  whereNotIn<K extends keyof ModelAttributes<TModel> & string>(
    column: K,
    values: readonly ModelAttributes<TModel>[K][],
  ): this {
    this.query.whereNotIn(column as never, values);
    return this;
  }

  groupBy(groupBy: QueryOptions<object>["groupBy"]): this {
    this.query.groupBy(groupBy);
    return this;
  }

  having(having: QueryWhere<object>): this {
    this.query.having(having as QueryWhere<Record<string, unknown>>);
    return this;
  }

  join(left: `${string}.${string}`, right: `${string}.${string}`): this {
    this.query.join(left, right);
    return this;
  }

  leftJoin(left: `${string}.${string}`, right: `${string}.${string}`): this {
    this.query.leftJoin(left, right);
    return this;
  }

  async paginate(options: { page: number; perPage: number }): Promise<{
    data: ModelQueryResult<TModel, TCounts>[];
    meta: Awaited<ReturnType<RepositoryQuery<Record<string, unknown>, "id">["paginate"]>>["meta"];
  }> {
    const { data, meta } = await this.query.paginate(options);
    return { data: await this.hydrateRows(data), meta };
  }

  whereExists(sql: string, params: readonly unknown[] = []): this {
    this.query.whereExists(sql, params);
    return this;
  }

  whereNotExists(sql: string, params: readonly unknown[] = []): this {
    this.query.whereNotExists(sql, params);
    return this;
  }

  whereHas(name: string, constrain?: (query: AnyRelationQuery) => void): this {
    return this.constrainExists(name, constrain, false);
  }

  has(name: string): this {
    return this.constrainExists(name, undefined, false);
  }

  doesntHave(name: string): this {
    return this.constrainExists(name, undefined, true);
  }

  whereDoesntHave(name: string, constrain?: (query: AnyRelationQuery) => void): this {
    return this.constrainExists(name, constrain, true);
  }

  withHasMany(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withHasMany"]>
  ): this {
    this.query.withHasMany(...args);
    return this;
  }

  withBelongsTo(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withBelongsTo"]>
  ): this {
    this.query.withBelongsTo(...args);
    return this;
  }

  withBelongsToMany(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withBelongsToMany"]>
  ): this {
    this.query.withBelongsToMany(...args);
    return this;
  }

  withMorphMany(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withMorphMany"]>
  ): this {
    this.query.withMorphMany(...args);
    return this;
  }

  withMorphOne(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withMorphOne"]>
  ): this {
    this.query.withMorphOne(...args);
    return this;
  }

  withMorphTo(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withMorphTo"]>
  ): this {
    this.query.withMorphTo(...args);
    return this;
  }

  withHasManyThrough(
    ...args: Parameters<RepositoryQuery<Record<string, unknown>, "id">["withHasManyThrough"]>
  ): this {
    this.query.withHasManyThrough(...args);
    return this;
  }

  withTrashed(): this {
    this.query.withTrashed();
    return this;
  }

  onlyTrashed(): this {
    this.query.onlyTrashed();
    return this;
  }

  async get(): Promise<ModelQueryResult<TModel, TCounts>[]> {
    return await this.hydrateRows(await this.query.get());
  }

  async keysetPaginate(options: KeysetOptions<ModelAttributes<TModel>>) {
    const page = await this.query.keysetPaginate(options as never);
    return { ...page, data: await this.hydrateRows(page.data) };
  }

  private async hydrateRows(
    rows: readonly Record<string, unknown>[],
  ): Promise<ModelQueryResult<TModel, TCounts>[]> {
    const statics = modelStatics(this.modelClass);
    const models: AnyModel[] = [];

    for (const row of rows) {
      const model = statics.newFromRecord(row, true) as AnyModel;

      for (const { name, relationQuery } of this.eager) {
        model.setLoaded(name, relationQuery.hydrateEager(row, name));
      }

      models.push(model);
    }

    await Promise.all(models.map((model) => runObservers(model as AnyModel, "retrieved")));

    const nested = this.eager.filter((item) => item.path.includes(".")).map((item) => item.path);
    await eagerLoadOnModels(models.filter(isLoadableModel), nested);
    return models as unknown as ModelQueryResult<TModel, TCounts>[];
  }

  async first(): Promise<ModelQueryResult<TModel, TCounts> | null> {
    this.query.limit(1);
    const models = await this.get();
    return models[0] ?? null;
  }

  async count(): Promise<number> {
    return this.query.count();
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  async pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    if (keyBy === undefined) {
      const values = await this.query.pluck(column);
      return values.map((value) => castPluckedValue(this.modelClass, column, value));
    }

    const keyed = await this.query.pluck(column, keyBy);
    const result = new Map<unknown, unknown>();

    for (const [key, value] of keyed) {
      result.set(
        castPluckedValue(this.modelClass, keyBy, key),
        castPluckedValue(this.modelClass, column, value),
      );
    }

    return result;
  }

  async value(column: string): Promise<unknown> {
    const value = await this.query.value(column);
    return castPluckedValue(this.modelClass, column, value);
  }

  async find(id: ModelIdentifier<TModel>): Promise<ModelQueryResult<TModel, TCounts> | null> {
    const primaryKey = resolveModelRepository(this.modelClass).getTable().primaryKey;
    return this.whereDynamic({ [primaryKey]: id } as QueryWhere<object>).first();
  }

  async findOrFail(
    id: ModelIdentifier<TModel>,
    errorFactory?: (id: unknown) => Error,
  ): Promise<ModelQueryResult<TModel, TCounts>> {
    const model = await this.find(id);

    if (model) {
      return model;
    }

    throw (
      errorFactory?.(id) ??
      new NotFoundError(`${(this.modelClass as { name: string }).name} ${String(id)} not found.`)
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: ModelQuery is thenable so `await User.where(...)` loads models.
  then(
    onfulfilled?: ((value: ModelQueryResult<TModel, TCounts>[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return this.get().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  withCount<TName extends string, TAlias extends string = `${TName}_count`>(
    name: TName,
    alias?: TAlias,
  ): ModelQuery<TModel, TCounts | TAlias>;
  withCount(name: string, alias = `${name}_count`): this {
    const statics = modelStatics(this.modelClass);
    ensureBooted(this.modelClass);
    const repository = resolveModelRepository(this.modelClass);
    const dummy = statics.newFromRecord({});
    const method = (dummy as unknown as Record<string, unknown>)[name];

    if (typeof method !== "function") {
      throw new Error(
        `${(this.modelClass as { name: string }).name} has no relation method ${name}().`,
      );
    }

    const relationQuery = method.call(dummy) as AnyRelationQuery;
    const exists = relationQuery.toExistsClause(repository.getTable().name);

    if (!exists.sql.startsWith("SELECT 1 ")) {
      throw new Error(`Cannot count relation ${name}: unexpected subquery shape.`);
    }

    this.query.withSubqueryCount(
      alias,
      `SELECT COUNT(*) ${exists.sql.slice("SELECT 1 ".length)}`,
      exists.params,
    );

    return this;
  }

  private constrainExists(
    name: string,
    constrain: ((query: AnyRelationQuery) => void) | undefined,
    not: boolean,
  ): this {
    const statics = modelStatics(this.modelClass);
    ensureBooted(this.modelClass);
    const repository = resolveModelRepository(this.modelClass);
    const dummy = statics.newFromRecord({});
    const method = (dummy as unknown as Record<string, unknown>)[name];

    if (typeof method !== "function") {
      throw new Error(
        `${(this.modelClass as { name: string }).name} has no relation method ${name}().`,
      );
    }

    const relationQuery = method.call(dummy) as AnyRelationQuery;
    constrain?.(relationQuery);
    const exists = relationQuery.toExistsClause(repository.getTable().name);
    return not
      ? this.whereNotExists(exists.sql, exists.params)
      : this.whereExists(exists.sql, exists.params);
  }
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

    if ((await runObservers(pending, "saving")) === false) {
      throw new Error(`${(this as { name: string }).name}.create() was cancelled by an observer.`);
    }

    if ((await runObservers(pending, "creating")) === false) {
      throw new Error(`${(this as { name: string }).name}.create() was cancelled by an observer.`);
    }

    const record = await repository.create(payload as MutationValues<object>);
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
    const casts = ModelClass.$casts ?? {};
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
        await applyCasts(dirty, casts, "dehydrate"),
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
  modelRepositories.set(
    model as object,
    repository as BaseRepository<Record<string, unknown>, "id">,
  );
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
