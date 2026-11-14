import { RecordNotFoundError } from "@getstrata/core/database/errors";
import { getBindingPorts } from "#strata-orm-internal";
import type { CursorPaginatedResult, KeysetCursor, KeysetOptions } from "../pagination/index.ts";
import type BaseRepository from "./baseRepository.ts";
import { type BoundModelFacade, getModelBinding, type Model, runObservers } from "./model.ts";
import { applyCasts, hydrateValue } from "./modelAttributes.ts";
import {
  eagerLoadOnModels,
  flattenRelationNames,
  isLoadableModel,
  loadNested,
  type RelationNameInput,
} from "./modelRelationLoader";
import { snapshotQueryPlan } from "./queryPlanSnapshot.ts";
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
import { type RepositoryQuery, snapshotRepositoryQuery } from "./repositoryQuery.ts";
import type { ModelWhere, QueryLockOptions, QueryOptions, QueryWhere } from "./types.ts";

function modelStatics(model: object): BoundModelFacade<Record<string, unknown>, "id", AnyModel> {
  return model as BoundModelFacade<Record<string, unknown>, "id", AnyModel>;
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
    private readonly firstValue: () => Promise<Pick<TEntity, K> | null>,
  ) {}
  keysetPaginate(options: KeysetOptions<TEntity>) {
    return this.page(options);
  }
  get(): Promise<Array<Pick<TEntity, K>>> {
    return this.load();
  }
  first(): Promise<Pick<TEntity, K> | null> {
    return this.firstValue();
  }
}

let snapshotModelQuery: <M extends object, C extends string>(
  query: ModelQuery<M, C>,
) => ModelQuery<M, C>;
class ModelQuery<TModel extends object = AnyModel, TCounts extends string = never> {
  private readonly eager: Array<{ name: string; path: string; relationQuery: AnyRelationQuery }> =
    [];

  constructor(
    private readonly modelClass: object,
    readonly query: RepositoryQuery<Record<string, unknown>, "id">,
  ) {}

  static {
    snapshotModelQuery = (query) => query.snapshot();
  }
  private snapshot(): ModelQuery<TModel, TCounts> {
    getBindingPorts(modelStatics(this.modelClass).binding).assertActive();
    const plan = new ModelQuery<TModel, TCounts>(
      this.modelClass,
      snapshotRepositoryQuery(this.query),
    );
    plan.eager.push(
      ...this.eager.map((item) => ({ ...item, relationQuery: item.relationQuery.snapshot() })),
    );
    return plan;
  }

  private terminal<V, A = undefined>(
    work: (plan: ModelQuery<TModel, TCounts>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const facade = modelStatics(this.modelClass);
    let plan: ModelQuery<TModel, TCounts>;
    let captured: A;
    try {
      getBindingPorts(facade.binding).assertActive();
      captured = snapshotQueryPlan(input as A);
      plan = this.snapshot();
    } catch (error) {
      return facade.binding.run(() => {
        throw error;
      });
    }
    return facade.binding.run(() => work(plan, captured));
  }

  with(...relations: RelationNameInput[]): this {
    const statics = modelStatics(this.modelClass);
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
      (limit) =>
        this.terminal(
          async (plan, captured) => {
            const rows = await plan.query.project(captured.columns, captured.limit);
            return rows.map(
              (row) =>
                applyCasts(row, modelStatics(plan.modelClass).$casts, "hydrate") as Pick<
                  ModelAttributes<TModel>,
                  K
                >,
            );
          },
          { columns, limit },
        ),
      (options) =>
        this.terminal(
          async (plan, captured) => {
            const page = await plan.query.projectKeyset(
              captured.columns,
              captured.options as never,
            );
            return {
              ...page,
              data: page.data.map(
                (row) =>
                  applyCasts(row, modelStatics(plan.modelClass).$casts, "hydrate") as Pick<
                    ModelAttributes<TModel>,
                    K
                  >,
              ),
            };
          },
          { columns, options },
        ),
      () =>
        this.terminal(
          async (plan, captured) => {
            const row = (await plan.query.project(captured.columns, 1))[0];
            return row
              ? (applyCasts(row, modelStatics(plan.modelClass).$casts, "hydrate") as Pick<
                  ModelAttributes<TModel>,
                  K
                >)
              : null;
          },
          { columns },
        ),
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

  paginate(options: { page: number; perPage: number }): Promise<{
    data: ModelQueryResult<TModel, TCounts>[];
    meta: Awaited<ReturnType<RepositoryQuery<Record<string, unknown>, "id">["paginate"]>>["meta"];
  }> {
    return this.terminal(async (plan, captured) => {
      const eager = [...plan.eager];
      const { data, meta } = await plan.query.paginate(captured);
      return { data: await plan.hydrateRows(data, eager), meta };
    }, options);
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

  get(): Promise<ModelQueryResult<TModel, TCounts>[]> {
    return this.terminal(async (plan) => {
      const eager = [...plan.eager];
      return await plan.hydrateRows(await plan.query.get(), eager);
    });
  }

  keysetPaginate(options: KeysetOptions<ModelAttributes<TModel>>) {
    return this.terminal(async (plan, captured) => {
      const eager = [...plan.eager];
      const page = await plan.query.keysetPaginate(captured as never);
      return { ...page, data: await plan.hydrateRows(page.data, eager) };
    }, options);
  }

  private async hydrateRows(
    rows: readonly Record<string, unknown>[],
    eager = [...this.eager],
  ): Promise<ModelQueryResult<TModel, TCounts>[]> {
    const statics = modelStatics(this.modelClass);
    const models: AnyModel[] = [];
    const knownAbsentMorphRoots = new Map<object, Set<string>>();
    const nested = eager.filter((item) => item.path.includes(".")).map((item) => item.path);
    const nestedRoots = new Set(
      eager.filter((item) => item.path.includes(".")).map((item) => item.name),
    );

    for (const row of rows) {
      const model = statics.newFromRecord(row, true) as AnyModel;
      const absentMorphRoots = new Set<string>();

      for (const { name, relationQuery } of eager) {
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
        // Observer objects may expose callback getters. Inspect only the owned
        // list, leaving user callbacks to runObservers and preserving reloads.
        if (getBindingPorts(getModelBinding(model)).observers.length) {
          knownAbsentMorphRoots.delete(model);
        }
        return runObservers(model as AnyModel, "retrieved");
      }),
    );

    await eagerLoadOnModels(models.filter(isLoadableModel), nested, knownAbsentMorphRoots);
    return models as unknown as ModelQueryResult<TModel, TCounts>[];
  }

  first(): Promise<ModelQueryResult<TModel, TCounts> | null> {
    return this.terminal(async (plan) => {
      plan.query.limit(1);
      const models = await plan.get();
      return models[0] ?? null;
    });
  }

  count(): Promise<number> {
    return this.terminal(async (plan) => {
      return plan.query.count();
    });
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(async (plan) => {
      if (keyBy === undefined) {
        const values = await plan.query.pluck(column);
        return values.map((value) => castPluckedValue(plan.modelClass, column, value));
      }

      const keyed = await plan.query.pluck(column, keyBy);
      const result = new Map<unknown, unknown>();

      for (const [key, value] of keyed) {
        result.set(
          castPluckedValue(plan.modelClass, keyBy, key),
          castPluckedValue(plan.modelClass, column, value),
        );
      }

      return result;
    });
  }

  value(column: string): Promise<unknown> {
    return this.terminal(async (plan) => {
      const value = await plan.query.value(column);
      return castPluckedValue(plan.modelClass, column, value);
    });
  }

  find(id: ModelIdentifier<TModel>): Promise<ModelQueryResult<TModel, TCounts> | null> {
    return this.terminal(async (plan, captured) => {
      const primaryKey = modelStatics(plan.modelClass).repository().getTable().primaryKey;
      return plan.whereDynamic({ [primaryKey]: captured } as QueryWhere<object>).first();
    }, id);
  }

  findOrFail(
    id: ModelIdentifier<TModel>,
    errorFactory?: (id: unknown) => Error,
  ): Promise<ModelQueryResult<TModel, TCounts>> {
    return this.terminal(
      async (plan, captured) => {
        const model = await plan.find(captured.id);

        if (model) {
          return model;
        }

        throw (
          captured.errorFactory?.(captured.id) ??
          new RecordNotFoundError(
            `${(plan.modelClass as { name: string }).name} ${String(captured.id)} not found.`,
          )
        );
      },
      { id, errorFactory },
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
    const repository = modelStatics(this.modelClass).repository();
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
    const repository = modelStatics(this.modelClass).repository();
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
export { flattenRelationNames, loadNested, ModelProjection, ModelQuery, snapshotModelQuery };
