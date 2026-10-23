import { NotFoundError } from "@getstrata/core/errors/http";
import type { CursorPaginatedResult, KeysetCursor, KeysetOptions } from "../pagination/index.ts";
import type BaseRepository from "./baseRepository.ts";
import type { Model } from "./model.ts";
import { applyCasts, hydrateValue } from "./modelAttributes.ts";
import {
  ensureBooted,
  getModelObservers,
  resolveModelRepository,
  runObservers,
} from "./modelRegistry.ts";
import type { AnyRelationQuery } from "./relationQuery.ts";
import type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasManyThroughRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
} from "./relationships.ts";
import type { RepositoryQuery } from "./repositoryQuery.ts";
import type { ModelWhere, QueryLockOptions, QueryOptions, QueryWhere } from "./types.ts";

function modelStatics(model: object): typeof Model {
  return model as typeof Model;
}

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

function resolveModelRelation(model: object, name: string): AnyRelationQuery {
  const method = (model as Record<string, unknown>)[name];
  if (typeof method !== "function") {
    throw new Error(
      `${(model.constructor as { name: string }).name} has no relation method ${name}().`,
    );
  }
  return method.call(model) as AnyRelationQuery;
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
  knownAbsentMorphRoots: ReadonlyMap<object, ReadonlySet<string>> = new Map(),
): Promise<void> {
  if (models.length === 0 || paths.length === 0) {
    return;
  }

  // A polymorphic edge can contain different concrete model types. Their next
  // relation methods and hydration owners cannot be borrowed from the first row.
  const byModel = new Map<object, typeof models>();
  for (const model of models) {
    const group = byModel.get(model.constructor) ?? [];
    group.push(model);
    byModel.set(model.constructor, group);
  }
  if (byModel.size > 1) {
    await Promise.all(
      [...byModel.values()].map((group) => eagerLoadOnModels(group, paths, knownAbsentMorphRoots)),
    );
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
      // Skip only targets known absent for this model before retrieved observers.
      // An observer may explicitly invalidate a previously present relation.
      const unloaded = models.filter(
        (model) => model.loaded(head) === undefined && !knownAbsentMorphRoots.get(model)?.has(head),
      );

      if (unloaded.length > 0) {
        const first = unloaded[0];
        if (!first) {
          return;
        }
        const relationQuery = resolveModelRelation(first, head);
        const query = first.getRepository().query();
        relationQuery.applyEagerLoad(query, head);
        const attached = await query.attachToRows(
          unloaded.map((model) => model.toObject() as Record<string, unknown>),
        );

        for (const [index, model] of unloaded.entries()) {
          const row = attached[index] ?? model.toObject();
          model.setLoaded(
            head,
            relationQuery.hydrateEager(row as Record<string, unknown>, head, nested.length > 0),
          );
        }
      }

      if (nested.length === 0) {
        return;
      }

      for (const model of models) {
        const value = model.loaded(head);
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          !isLoadableModel(value)
        ) {
          const relationQuery = resolveModelRelation(model, head);
          if (relationQuery.kind === "morphTo") {
            // A prior flat eager load caches records. Upgrade only when the
            // caller requests traversal, using those bytes without a refresh.
            model.setLoaded(
              head,
              relationQuery.hydrateEager({ ...model.toObject(), [head]: value }, head, true),
            );
          }
        }
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

function castPluckedValue(modelClass: object, column: string, value: unknown): unknown {
  const cast = modelStatics(modelClass).$casts?.[column];
  return cast ? hydrateValue(value, cast) : value;
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

  // Parameters<generic method> erases related records and turns their keys into never.
  // Named argument tuples retain inference and preserve exact runtime forwarding.
  withHasMany<
    TChild extends object,
    LocalKey extends keyof Record<string, unknown> & string,
    ForeignKey extends keyof TChild & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: HasManyRelation<Record<string, unknown>, TChild, LocalKey, ForeignKey>,
      childRepository: BaseRepository<TChild, keyof TChild & string>,
      options?: Omit<QueryOptions<TChild>, "where">,
    ]
  ): this {
    this.query.withHasMany(...args);
    return this;
  }

  withBelongsTo<
    TParent extends object,
    ForeignKey extends keyof Record<string, unknown> & string,
    OwnerKey extends keyof TParent & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: BelongsToRelation<Record<string, unknown>, TParent, ForeignKey, OwnerKey>,
      parentRepository: BaseRepository<TParent, OwnerKey>,
      options?: Omit<QueryOptions<TParent>, "where">,
    ]
  ): this {
    this.query.withBelongsTo(...args);
    return this;
  }

  withBelongsToMany<
    TRelated extends object,
    Pivot extends object,
    ParentKey extends keyof Record<string, unknown> & string,
    RelatedKey extends keyof TRelated & string,
    ForeignPivotKey extends keyof Pivot & string,
    RelatedPivotKey extends keyof Pivot & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: BelongsToManyRelation<
        Record<string, unknown>,
        TRelated,
        Pivot,
        ParentKey,
        RelatedKey,
        ForeignPivotKey,
        RelatedPivotKey
      >,
      relatedRepository: BaseRepository<TRelated, RelatedKey>,
      options?: Omit<QueryOptions<TRelated>, "where">,
    ]
  ): this {
    this.query.withBelongsToMany(...args);
    return this;
  }

  withMorphMany<
    TChild extends object,
    LocalKey extends keyof Record<string, unknown> & string,
    MorphTypeKey extends keyof TChild & string,
    MorphIdKey extends keyof TChild & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: MorphManyRelation<
        Record<string, unknown>,
        TChild,
        LocalKey,
        MorphTypeKey,
        MorphIdKey
      >,
      childRepository: BaseRepository<TChild, keyof TChild & string>,
      options?: Omit<QueryOptions<TChild>, "where">,
    ]
  ): this {
    this.query.withMorphMany(...args);
    return this;
  }

  withMorphOne<
    TChild extends object,
    LocalKey extends keyof Record<string, unknown> & string,
    MorphTypeKey extends keyof TChild & string,
    MorphIdKey extends keyof TChild & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: MorphOneRelation<
        Record<string, unknown>,
        TChild,
        LocalKey,
        MorphTypeKey,
        MorphIdKey
      >,
      childRepository: BaseRepository<TChild, keyof TChild & string>,
      options?: Omit<QueryOptions<TChild>, "where">,
    ]
  ): this {
    this.query.withMorphOne(...args);
    return this;
  }

  withMorphTo<
    TParent extends object,
    MorphTypeKey extends keyof Record<string, unknown> & string,
    MorphIdKey extends keyof Record<string, unknown> & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: MorphToRelation<Record<string, unknown>, MorphTypeKey, MorphIdKey>,
      repositoriesByType: ReadonlyMap<string, BaseRepository<TParent, keyof TParent & string>>,
      options?: Omit<QueryOptions<TParent>, "where">,
      optionsByType?: ReadonlyMap<string, QueryOptions<TParent>>,
    ]
  ): this {
    this.query.withMorphTo(...args);
    return this;
  }

  withHasManyThrough<
    TFar extends object,
    LocalKey extends keyof Record<string, unknown> & string,
    SecondKey extends keyof TFar & string,
    Alias extends string,
  >(
    ...args: [
      as: Alias,
      relation: HasManyThroughRelation<
        Record<string, unknown>,
        TFar,
        LocalKey,
        string,
        string,
        SecondKey
      >,
      farRepository: BaseRepository<TFar, keyof TFar & string>,
      options?: Omit<QueryOptions<TFar>, "where">,
    ]
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
    const knownAbsentMorphRoots = new Map<object, Set<string>>();
    const nested = this.eager.filter((item) => item.path.includes(".")).map((item) => item.path);
    const nestedRoots = new Set(
      this.eager.filter((item) => item.path.includes(".")).map((item) => item.name),
    );

    for (const row of rows) {
      const model = statics.newFromRecord(row, true) as AnyModel;
      const absentMorphRoots = new Set<string>();

      for (const { name, relationQuery } of this.eager) {
        const value = relationQuery.hydrateEager(row, name, nestedRoots.has(name));
        model.setLoaded(name, value);
        if (relationQuery.kind === "morphTo" && value === undefined) absentMorphRoots.add(name);
        else absentMorphRoots.delete(name);
      }

      if (absentMorphRoots.size > 0) knownAbsentMorphRoots.set(model, absentMorphRoots);
      models.push(model);
    }

    await Promise.all(
      models.map((model) => {
        // Retrieved hooks can invalidate or materialize relations, including an
        // absent target. Keep their existing reload semantics instead of caching absence.
        if (getModelObservers(model.constructor)?.some((observer) => observer.retrieved)) {
          knownAbsentMorphRoots.delete(model);
        }
        return runObservers(model as AnyModel, "retrieved");
      }),
    );

    await eagerLoadOnModels(models.filter(isLoadableModel), nested, knownAbsentMorphRoots);
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

export type { AnyModel, ModelAttributes, ModelIdentifier, RelationNameInput };
export { flattenRelationNames, loadNested, ModelProjection, ModelQuery };
