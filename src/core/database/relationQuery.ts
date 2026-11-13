import { getBindingPorts, type Session } from "#strata-orm-internal";
import type BaseRepository from "./baseRepository.ts";
import { getRepositoryBinding } from "./baseRepository.ts";
import { getModelBinding, Model, saveRelatedModel } from "./model.ts";
import { projectPluck } from "./pluck.ts";
import { buildJoinClause, buildQueryWhereClause, qualifyColumn, quoteIdentifier } from "./query.ts";
import { snapshotQueryPlan } from "./queryPlanSnapshot.ts";
import type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasManyThroughRelation,
  HasOneRelation,
  MorphManyRelation,
  MorphOneRelation,
  MorphToRelation,
} from "./relationships.ts";
import type { RepositoryQuery } from "./repositoryQuery.ts";
import type { SqlDialect } from "./sqlDialects";
import type { QueryOptions, QueryWhere } from "./types.ts";

function reselectRelated<R extends object, K extends keyof R & string>(
  repository: BaseRepository<R, K>,
  session: Session,
): BaseRepository<R, K> {
  const binding = getRepositoryBinding(repository);
  getBindingPorts(binding).assertActive();
  if (binding.session !== session)
    throw new TypeError("Related repository requires the exact active session.");
  return repository;
}
async function executeRows<R extends object = Record<string, unknown>>(
  session: Session,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<R[]> {
  return [...(await session.execute<R>({ text: sql, params: parameters }))];
}

function snapshotHost<R extends object, K extends keyof R & string>(
  host: RelationHost<R, K>,
): RelationHost<R, K> {
  const repository = host.getRepository();
  const binding = getRepositoryBinding(repository);
  getBindingPorts(binding).assertActive();
  const values = Object.fromEntries(
    binding.table.columns.map((key) => [key, host.get(key as keyof R)]),
  ) as R;
  const detached = snapshotQueryPlan(values);
  const id = snapshotQueryPlan(host.id);
  return { id, get: <P extends keyof R>(key: P) => detached[key], getRepository: () => repository };
}

type RelatedRecord = {
  id: unknown;
  get<K extends string>(key: K): unknown;
};

interface RelatedModelClass<TRelated extends object, RelatedKey extends keyof TRelated & string> {
  name: string;
  repository(): BaseRepository<TRelated, RelatedKey>;
  create(
    attributes: Record<string, unknown>,
    forced?: Record<string, unknown>,
  ): Promise<RelatedRecord>;
  newFromRecord(record: TRelated, exists?: boolean): RelatedRecord;
}

interface RelationHost<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  readonly id: TEntity[PrimaryKey];
  get<K extends keyof TEntity>(key: K): TEntity[K];
  getRepository(): BaseRepository<TEntity, PrimaryKey>;
}

type RelationKind =
  | "hasMany"
  | "hasOne"
  | "belongsTo"
  | "belongsToMany"
  | "hasManyThrough"
  | "morphMany"
  | "morphOne"
  | "morphTo";

type ExistsClause = { sql: string; params: unknown[] };

function asWhere<T extends object>(where: Record<string, unknown>): QueryWhere<T> {
  return where as QueryWhere<T>;
}

function ownerId(owner: { id?: unknown } | RelatedRecord, ownerKey: string): unknown {
  if (typeof (owner as RelatedRecord).get === "function") {
    return (owner as RelatedRecord).get(ownerKey);
  }

  if (owner && typeof owner === "object" && "id" in owner && owner.id !== undefined) {
    return owner.id;
  }

  throw new Error("belongsTo.associate() requires a related model or { id }.");
}

function thenGet<T>(
  get: () => Promise<T>,
  onfulfilled?: ((value: T) => unknown) | null,
  onrejected?: ((reason: unknown) => unknown) | null,
): Promise<unknown> {
  return get().then(onfulfilled ?? undefined, onrejected ?? undefined);
}

function pluckFromQuery(
  query: RepositoryQuery<Record<string, unknown>, string> | null | undefined,
  column: string,
  keyBy?: string,
): Promise<unknown[] | Map<unknown, unknown>> {
  if (!query) {
    return Promise.resolve(keyBy === undefined ? [] : new Map());
  }

  return keyBy === undefined ? query.pluck(column) : query.pluck(column, keyBy);
}

function scopedRelatedQuery<T extends object, K extends keyof T & string>(
  model: RelatedModelClass<T, K>,
  repository = model.repository(),
): RepositoryQuery<T, K> {
  const query = repository.query();
  const scopedModel = model as RelatedModelClass<T, K> & {
    scopeQuery?: (query: RepositoryQuery<T, K>) => RepositoryQuery<T, K>;
  };
  return scopedModel.scopeQuery?.(query) ?? query;
}

function relatedOptions<T extends object, K extends keyof T & string>(
  model: RelatedModelClass<T, K>,
  filters: QueryWhere<T>[],
  options: Omit<QueryOptions<T>, "where"> = {},
): QueryOptions<T> {
  const query = scopedRelatedQuery(model);
  for (const filter of filters) query.where(filter);
  return { ...query.getOptions(), ...options };
}

function relatedRead<T extends object, K extends keyof T & string>(
  model: RelatedModelClass<T, K>,
  connection: Session,
  binding: QueryWhere<T>,
  filters: QueryWhere<T>[],
  options: Omit<QueryOptions<T>, "where"> = {},
): RepositoryQuery<T, K> {
  const query = scopedRelatedQuery(model, reselectRelated(model.repository(), connection));
  query.where(binding).protectWhere();
  for (const filter of filters) query.where(filter);
  if (options.orderBy) query.orderBy(options.orderBy);
  if (options.limit !== undefined) query.limit(options.limit);
  return query;
}

function relatedConditions<T extends object, K extends keyof T & string>(
  dialect: SqlDialect,
  model: RelatedModelClass<T, K>,
  filters: QueryWhere<T>[],
  options: Omit<QueryOptions<T>, "where"> = {},
  parameters: unknown[] = [],
  reservedTables: string[] = [],
) {
  const compiled = relatedOptions(model, filters, options);
  if (compiled.joins?.some((join) => reservedTables.includes(join.table))) {
    throw new Error(
      "A related model scope joins a reserved relation table; use an explicitly aliased correlated predicate instead.",
    );
  }
  const extra = buildQueryWhereClause(
    dialect,
    model.repository().getTable(),
    compiled,
    compiled.whereNodes,
    parameters,
  );
  const predicate = extra.clause.replace(/^ WHERE /, "");
  return {
    sql: predicate ? ` AND (${predicate})` : "",
    joins: buildJoinClause(dialect, compiled.joins),
    params: extra.params,
  };
}

class HasManyRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "hasMany";
  private extraWhere: QueryWhere<TChild>[] = [];
  private extraOptions: Omit<QueryOptions<TChild>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TChild, ChildKey>,
    readonly relation: HasManyRelation<TParent, TChild, ParentKey, keyof TChild & string>,
  ) {}

  snapshot() {
    const copy = new HasManyRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.extraWhere = snapshotQueryPlan(this.extraWhere);
    copy.extraOptions = snapshotQueryPlan(this.extraOptions);
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TChild>): this {
    this.extraWhere.push({ ...where });
    return this;
  }

  orderBy(orderBy: QueryOptions<TChild>["orderBy"]): this {
    this.extraOptions = { ...this.extraOptions, orderBy };
    return this;
  }

  limit(limit: number): this {
    this.extraOptions = { ...this.extraOptions, limit };
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    query.withHasMany(
      alias,
      this.relation,
      this.related.repository() as never,
      relatedOptions(this.related, this.extraWhere, this.extraOptions),
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TChild));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const childTable = this.related.repository().getTable().name;
    const extra = relatedConditions(
      dialect,
      this.related,
      this.extraWhere,
      this.extraOptions,
      [],
      [parentTable],
    );
    const sql = `SELECT 1 FROM ${quoteIdentifier(dialect, childTable)}${extra.joins} WHERE ${qualifyColumn(dialect, childTable, this.relation.foreignKey)} = ${qualifyColumn(dialect, parentTable, this.relation.localKey)}${extra.sql}`;
    return { sql, params: extra.params };
  }

  private scopedQuery(): RepositoryQuery<TChild, ChildKey> {
    return relatedRead(
      this.related,
      getRepositoryBinding(this.parent.getRepository()).session,
      asWhere<TChild>({ [this.relation.foreignKey]: this.parent.get(this.relation.localKey) }),
      this.extraWhere,
      this.extraOptions,
    );
  }

  get(): Promise<RelatedRecord[]> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.scopedQuery().get();
      return rows.map((row) => plan.related.newFromRecord(row as TChild));
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.limit(1).get();
      return rows[0] ?? null;
    }, {});
  }

  count(): Promise<number> {
    return this.terminal(async (plan, _input) => {
      return plan.scopedQuery().count();
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        return pluckFromQuery(plan.scopedQuery() as never, _input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        return plan.scopedQuery().value(_input.column as never);
      },
      { column },
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.terminal(
      async (plan, _input) => {
        return plan.related.create(_input.attributes, {
          [plan.relation.foreignKey]: plan.parent.get(plan.relation.localKey),
        });
      },
      { attributes },
    );
  }

  save(related: RelatedRecord | Record<string, unknown>): Promise<RelatedRecord> {
    let plan: ReturnType<this["snapshot"]>;
    const binding = getRepositoryBinding(this.parent.getRepository());
    try {
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      if (related instanceof Model) {
        const source = getModelBinding(related);
        if (source.session !== binding.session)
          throw new TypeError("Related model requires the exact active session.");
        return saveRelatedModel(related as never, {
          [plan.relation.foreignKey]: plan.parent.get(plan.relation.localKey),
        }) as Promise<RelatedRecord>;
      }
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return plan.create(related as Record<string, unknown>);
  }

  createMany(records: ReadonlyArray<Record<string, unknown>>): Promise<RelatedRecord[]> {
    return this.terminal(
      async (plan, _input) => {
        return Promise.all(_input.records.map((attributes) => plan.create(attributes)));
      },
      { records },
    );
  }
}

class HasOneRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "hasOne";
  private inner: HasManyRelationQuery<TParent, ParentKey, TChild, ChildKey>;

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TChild, ChildKey>,
    readonly relation: HasOneRelation<TParent, TChild, ParentKey, keyof TChild & string>,
  ) {
    this.inner = new HasManyRelationQuery(parent, related, {
      type: "hasMany",
      name: relation.name,
      localKey: relation.localKey,
      foreignKey: relation.foreignKey,
    });
  }

  snapshot() {
    const copy = new HasOneRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.inner = this.inner.snapshot();
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TChild>): this {
    this.inner.where(where);
    return this;
  }

  orderBy(orderBy: QueryOptions<TChild>["orderBy"]): this {
    this.inner.orderBy(orderBy);
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    this.inner.applyEagerLoad(query, alias);
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const hydrated = this.inner.hydrateEager(row, alias) as RelatedRecord[];
    return hydrated[0];
  }

  toExistsClause(parentTable: string): ExistsClause {
    return this.inner.toExistsClause(parentTable);
  }

  get(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      return plan.inner.limit(1).first();
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      return plan.get();
    }, {});
  }

  count(): Promise<number> {
    return this.terminal(async (plan, _input) => {
      return plan.inner.count();
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        const query = plan.inner.limit(1);
        return _input.keyBy === undefined
          ? query.pluck(_input.column)
          : query.pluck(_input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        return plan.inner.limit(1).value(_input.column);
      },
      { column },
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.terminal(
      async (plan, _input) => {
        return plan.inner.create(_input.attributes);
      },
      { attributes },
    );
  }

  save(related: RelatedRecord | Record<string, unknown>): Promise<RelatedRecord> {
    return this.terminal(
      async (plan, _input) => {
        return plan.inner.save(_input.related);
      },
      { related },
    );
  }
}

class BelongsToRelationQuery<
  TChild extends object,
  ChildKey extends keyof TChild & string,
  TParent extends object,
  ParentKey extends keyof TParent & string,
> {
  readonly kind: RelationKind = "belongsTo";
  private extraWhere: QueryWhere<TParent>[] = [];
  private extraOptions: Omit<QueryOptions<TParent>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TChild, ChildKey>,
    private readonly related: RelatedModelClass<TParent, ParentKey>,
    readonly relation: BelongsToRelation<TChild, TParent, keyof TChild & string, ParentKey>,
  ) {}

  snapshot() {
    const copy = new BelongsToRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.extraWhere = snapshotQueryPlan(this.extraWhere);
    copy.extraOptions = snapshotQueryPlan(this.extraOptions);
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TParent>): this {
    this.extraWhere.push({ ...where });
    return this;
  }

  orderBy(orderBy: QueryOptions<TParent>["orderBy"]): this {
    this.extraOptions = { ...this.extraOptions, orderBy };
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TChild, ChildKey>, alias: string): void {
    query.withBelongsTo(
      alias,
      this.relation,
      this.related.repository() as never,
      relatedOptions(this.related, this.extraWhere, this.extraOptions),
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias];
    return value ? this.related.newFromRecord(value as TParent) : value;
  }

  toExistsClause(parentTable: string): ExistsClause {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const relatedTable = this.related.repository().getTable().name;
    const extra = relatedConditions(
      dialect,
      this.related,
      this.extraWhere,
      this.extraOptions,
      [],
      [parentTable],
    );
    const sql = `SELECT 1 FROM ${quoteIdentifier(dialect, relatedTable)}${extra.joins} WHERE ${qualifyColumn(dialect, relatedTable, this.relation.ownerKey)} = ${qualifyColumn(dialect, parentTable, this.relation.foreignKey)}${extra.sql}`;
    return { sql, params: extra.params };
  }

  get(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      const query = plan.relatedQuery();

      if (!query) {
        return null;
      }

      const row = await query.first();
      return row ? plan.related.newFromRecord(row as TParent) : null;
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      return plan.get();
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        return pluckFromQuery(plan.relatedQuery() as never, _input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        return plan.relatedQuery()?.value(_input.column as never) ?? null;
      },
      { column },
    );
  }

  private relatedQuery(): RepositoryQuery<TParent, ParentKey> | null {
    const foreign = this.parent.get(this.relation.foreignKey);

    if (foreign === null || foreign === undefined) {
      return null;
    }

    return relatedRead(
      this.related,
      getRepositoryBinding(this.parent.getRepository()).session,
      asWhere<TParent>({ [this.relation.ownerKey]: foreign }),
      this.extraWhere,
      this.extraOptions,
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  associate(owner: { id?: unknown } | RelatedRecord): Promise<void> {
    return this.terminal(
      async (plan, _input) => {
        await plan.parent.getRepository().updateById(plan.parent.id, {
          [plan.relation.foreignKey]: ownerId(_input.owner, plan.relation.ownerKey),
        } as never);
      },
      { owner },
    );
  }

  dissociate(): Promise<void> {
    return this.terminal(async (plan, _input) => {
      await plan.parent.getRepository().updateById(plan.parent.id, {
        [plan.relation.foreignKey]: null,
      } as never);
    }, {});
  }
}

function pivotIdKey(id: unknown): unknown {
  return typeof id === "number" || typeof id === "bigint" ? String(id) : id;
}

function hasRepeatedId(ids: readonly unknown[]): boolean {
  const seen = new Set<unknown>();
  for (const id of ids) {
    const key = pivotIdKey(id);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function canBatchPivotToggle(ids: readonly unknown[]): boolean {
  // Without column types/collations, only canonical integer identifiers have
  // predictable equality here. Let database comparisons decide other IDs.
  return ids.every(
    (id) =>
      (typeof id === "bigint" &&
        id >= BigInt(Number.MIN_SAFE_INTEGER) &&
        id <= BigInt(Number.MAX_SAFE_INTEGER)) ||
      (typeof id === "number" && Number.isSafeInteger(id)) ||
      (typeof id === "string" && /^(?:0|-?[1-9]\d*)$/.test(id) && Number.isSafeInteger(Number(id))),
  );
}

class BelongsToManyRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TRelated extends object,
  RelatedKey extends keyof TRelated & string,
  Pivot extends object,
> {
  readonly kind: RelationKind = "belongsToMany";
  private extraWhere: QueryWhere<TRelated>[] = [];
  private extraOptions: Omit<QueryOptions<TRelated>, "where"> = {};
  private pivotValues: Record<string, unknown> = {};

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TRelated, RelatedKey>,
    readonly relation: BelongsToManyRelation<
      TParent,
      TRelated,
      Pivot,
      ParentKey,
      RelatedKey,
      keyof Pivot & string,
      keyof Pivot & string
    >,
  ) {}

  snapshot() {
    const copy = new BelongsToManyRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.extraWhere = snapshotQueryPlan(this.extraWhere);
    copy.extraOptions = snapshotQueryPlan(this.extraOptions);
    copy.pivotValues = snapshotQueryPlan(this.pivotValues);
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TRelated>): this {
    this.extraWhere.push({ ...where });
    return this;
  }

  orderBy(orderBy: QueryOptions<TRelated>["orderBy"]): this {
    this.extraOptions = { ...this.extraOptions, orderBy };
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    query.withBelongsToMany(
      alias,
      this.relation,
      this.related.repository() as never,
      relatedOptions(this.related, this.extraWhere, this.extraOptions),
    );
  }

  withPivotValues(values: Record<string, unknown>): this {
    this.pivotValues = { ...this.pivotValues, ...values };
    return this;
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TRelated));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const relatedTable = this.related.repository().getTable().name;
    const extra = relatedConditions(
      dialect,
      this.related,
      this.extraWhere,
      this.extraOptions,
      [],
      [parentTable, this.relation.pivotTable],
    );
    const sql = `SELECT 1 FROM ${quoteIdentifier(dialect, relatedTable)} INNER JOIN ${quoteIdentifier(dialect, this.relation.pivotTable)} ON ${qualifyColumn(dialect, this.relation.pivotTable, this.relation.relatedPivotKey)} = ${qualifyColumn(dialect, relatedTable, this.relation.relatedKey)}${extra.joins} WHERE ${qualifyColumn(dialect, this.relation.pivotTable, this.relation.foreignPivotKey)} = ${qualifyColumn(dialect, parentTable, this.relation.parentKey)}${extra.sql}`;
    return { sql, params: extra.params };
  }

  private connection(): Session {
    return getRepositoryBinding(this.parent.getRepository()).session;
  }

  private atomically(work: (session: Session) => Promise<void>): Promise<void> {
    return this.connection().transaction((child) => work(child));
  }

  get(): Promise<RelatedRecord[]> {
    return this.terminal(async (plan, _input) => {
      const query = await plan.relatedQuery();
      const rows = query ? await query.get() : [];
      return rows.map((row) => plan.related.newFromRecord(row));
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.get();
      return rows[0] ?? null;
    }, {});
  }

  count(): Promise<number> {
    return this.terminal(async (plan, _input) => {
      const query = await plan.relatedQuery();
      return query ? query.count() : 0;
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        return pluckFromQuery((await plan.relatedQuery()) as never, _input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        const query = await plan.relatedQuery();
        return query ? query.value(_input.column as never) : null;
      },
      { column },
    );
  }

  private async relatedQuery(): Promise<RepositoryQuery<TRelated, RelatedKey> | null> {
    const filters = this.extraWhere.map((where) => ({ ...where }));
    const options = { ...this.extraOptions };
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const parentId = this.parent.get(this.relation.parentKey);
    const pivotRows = await executeRows<Pivot>(
      this.connection(),
      `SELECT * FROM ${quoteIdentifier(dialect, this.relation.pivotTable)} WHERE ${quoteIdentifier(dialect, String(this.relation.foreignPivotKey))} = ${dialect.placeholder(1)}`,
      [parentId],
    );

    if (pivotRows.length === 0) {
      return null;
    }

    const relatedIds = [
      ...new Set(
        pivotRows.map(
          (row) => row[this.relation.relatedPivotKey] as unknown as TRelated[RelatedKey],
        ),
      ),
    ];
    return relatedRead(
      this.related,
      this.connection(),
      asWhere<TRelated>({ [this.relation.relatedKey]: relatedIds }),
      filters,
      options,
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  attach(ids: unknown | readonly unknown[]): Promise<void> {
    return this.terminal(
      async (plan, _input) => {
        const list = Array.isArray(_input.ids) ? _input.ids : [_input.ids];
        if (list.length === 0) return;
        await plan.atomically((connection) => plan.insertPivotRows(connection, list));
      },
      { ids },
    );
  }

  toggle(ids: unknown | readonly unknown[]): Promise<void> {
    return this.terminal(
      async (plan, _input) => {
        const dialect = getRepositoryBinding(plan.parent.getRepository()).dialect;
        const list = Array.isArray(_input.ids) ? _input.ids : [_input.ids];
        if (list.length === 0) return;
        await plan.atomically(async (connection) => {
          if (!canBatchPivotToggle(list) || hasRepeatedId(list)) {
            for (const id of list) await plan.toggleOne(connection, id);
            return;
          }
          const parentId = plan.parent.get(plan.relation.parentKey);
          const relatedColumn = quoteIdentifier(dialect, String(plan.relation.relatedPivotKey));
          const parentColumn = quoteIdentifier(dialect, String(plan.relation.foreignPivotKey));
          const placeholders = list.map((_, index) => dialect.placeholder(index + 2));
          const existing = await executeRows<Record<string, unknown>>(
            connection,
            `SELECT ${relatedColumn} FROM ${quoteIdentifier(dialect, plan.relation.pivotTable)} WHERE ${parentColumn} = ${dialect.placeholder(1)} AND ${relatedColumn} IN (${placeholders.join(", ")})`,
            [parentId, ...list],
          );
          const existingIds = new Set(
            existing.map((row) => pivotIdKey(row[String(plan.relation.relatedPivotKey)])),
          );
          const present = list.filter((id) => existingIds.has(pivotIdKey(id)));
          const missing = list.filter((id) => !existingIds.has(pivotIdKey(id)));
          if (present.length > 0) await plan.deletePivotRows(connection, present);
          if (missing.length > 0) await plan.insertPivotRows(connection, missing);
        });
      },
      { ids },
    );
  }

  detach(ids?: unknown | readonly unknown[]): Promise<void> {
    return this.terminal(
      async (plan, _input) => {
        const dialect = getRepositoryBinding(plan.parent.getRepository()).dialect;
        const parentId = plan.parent.get(plan.relation.parentKey);

        if (_input.ids === undefined) {
          await executeRows(
            plan.connection(),
            `DELETE FROM ${quoteIdentifier(dialect, plan.relation.pivotTable)} WHERE ${quoteIdentifier(dialect, String(plan.relation.foreignPivotKey))} = ${dialect.placeholder(1)}`,
            [parentId],
          );
          return;
        }

        const list = Array.isArray(_input.ids) ? _input.ids : [_input.ids];
        if (list.length === 0) return;
        await plan.deletePivotRows(plan.connection(), list);
      },
      { ids },
    );
  }

  private async toggleOne(connection: Session, id: unknown): Promise<void> {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const parentId = this.parent.get(this.relation.parentKey);
    const existing = await executeRows(
      connection,
      `SELECT 1 FROM ${quoteIdentifier(dialect, this.relation.pivotTable)} WHERE ${quoteIdentifier(dialect, String(this.relation.foreignPivotKey))} = ${dialect.placeholder(1)} AND ${quoteIdentifier(dialect, String(this.relation.relatedPivotKey))} = ${dialect.placeholder(2)} LIMIT 1`,
      [parentId, id],
    );
    if (existing.length > 0) await this.deletePivotRows(connection, [id]);
    else await this.insertPivotRows(connection, [id]);
  }

  private async insertPivotRows(connection: Session, list: readonly unknown[]): Promise<void> {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const parentId = this.parent.get(this.relation.parentKey);
    const extraKeys = Object.keys(this.pivotValues);
    const extraColumns =
      extraKeys.length > 0
        ? `, ${extraKeys.map((key) => quoteIdentifier(dialect, key)).join(", ")}`
        : "";
    const extraValues = extraKeys.map((key) => this.pivotValues[key]);
    const width = 2 + extraKeys.length;
    const tuples = list.map((_, row) => {
      const slots = Array.from({ length: width }, (__, column) =>
        dialect.placeholder(row * width + column + 1),
      );
      return `(${slots.join(", ")})`;
    });
    const params: unknown[] = [];
    for (const id of list) params.push(parentId, id, ...extraValues);
    await executeRows(
      connection,
      `INSERT INTO ${quoteIdentifier(dialect, this.relation.pivotTable)} (${quoteIdentifier(dialect, String(this.relation.foreignPivotKey))}, ${quoteIdentifier(dialect, String(this.relation.relatedPivotKey))}${extraColumns}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }

  private async deletePivotRows(connection: Session, list: readonly unknown[]): Promise<void> {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const parentId = this.parent.get(this.relation.parentKey);
    const placeholders = list.map((_, index) => dialect.placeholder(index + 2));
    await executeRows(
      connection,
      `DELETE FROM ${quoteIdentifier(dialect, this.relation.pivotTable)} WHERE ${quoteIdentifier(dialect, String(this.relation.foreignPivotKey))} = ${dialect.placeholder(1)} AND ${quoteIdentifier(dialect, String(this.relation.relatedPivotKey))} IN (${placeholders.join(", ")})`,
      [parentId, ...list],
    );
  }

  sync(ids: readonly unknown[]): Promise<void> {
    return this.terminal(
      async (plan, _input) => {
        await plan.detach();

        if (_input.ids.length > 0) {
          await plan.attach(_input.ids);
        }
      },
      { ids },
    );
  }

  create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.terminal(
      async (plan, _input) => {
        const related = await plan.related.create(_input.attributes);
        await plan.attach(related.id);
        return related;
      },
      { attributes },
    );
  }
}

class MorphManyRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "morphMany";
  private extraWhere: QueryWhere<TChild>[] = [];
  private extraOptions: Omit<QueryOptions<TChild>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TChild, ChildKey>,
    readonly relation: MorphManyRelation<
      TParent,
      TChild,
      ParentKey,
      keyof TChild & string,
      keyof TChild & string
    >,
  ) {}

  snapshot() {
    const copy = new MorphManyRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.extraWhere = snapshotQueryPlan(this.extraWhere);
    copy.extraOptions = snapshotQueryPlan(this.extraOptions);
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TChild>): this {
    this.extraWhere.push({ ...where });
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    query.withMorphMany(
      alias,
      this.relation,
      this.related.repository() as never,
      relatedOptions(this.related, this.extraWhere, this.extraOptions),
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TChild));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const childTable = this.related.repository().getTable().name;
    const extra = relatedConditions(
      dialect,
      this.related,
      [
        asWhere<TChild>({ [this.relation.morphTypeKey]: this.relation.morphType }),
        ...this.extraWhere,
      ],
      this.extraOptions,
      [],
      [parentTable],
    );
    const sql = `SELECT 1 FROM ${quoteIdentifier(dialect, childTable)}${extra.joins} WHERE ${qualifyColumn(dialect, childTable, this.relation.morphIdKey)} = ${qualifyColumn(dialect, parentTable, this.relation.localKey)}${extra.sql}`;
    return { sql, params: extra.params };
  }

  private scopedQuery(): RepositoryQuery<TChild, ChildKey> {
    return relatedRead(
      this.related,
      getRepositoryBinding(this.parent.getRepository()).session,
      asWhere<TChild>({
        [this.relation.morphTypeKey]: this.relation.morphType,
        [this.relation.morphIdKey]: this.parent.get(this.relation.localKey),
      }),
      this.extraWhere,
    );
  }

  get(): Promise<RelatedRecord[]> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.scopedQuery().get();
      return rows.map((row) => plan.related.newFromRecord(row as TChild));
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.get();
      return rows[0] ?? null;
    }, {});
  }

  count(): Promise<number> {
    return this.terminal(async (plan, _input) => {
      return plan.scopedQuery().count();
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        return pluckFromQuery(plan.scopedQuery() as never, _input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        return plan.scopedQuery().value(_input.column as never);
      },
      { column },
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.terminal(
      async (plan, _input) => {
        return plan.related.create(_input.attributes, {
          [plan.relation.morphTypeKey]: plan.relation.morphType,
          [plan.relation.morphIdKey]: plan.parent.get(plan.relation.localKey),
        });
      },
      { attributes },
    );
  }
}

class MorphOneRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "morphOne";
  private inner: MorphManyRelationQuery<TParent, ParentKey, TChild, ChildKey>;

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TChild, ChildKey>,
    readonly relation: MorphOneRelation<
      TParent,
      TChild,
      ParentKey,
      keyof TChild & string,
      keyof TChild & string
    >,
  ) {
    this.inner = new MorphManyRelationQuery(parent, related, {
      type: "morphMany",
      name: relation.name,
      localKey: relation.localKey,
      morphTypeKey: relation.morphTypeKey,
      morphIdKey: relation.morphIdKey,
      morphType: relation.morphType,
    });
  }

  snapshot() {
    const copy = new MorphOneRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.inner = this.inner.snapshot();
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TChild>): this {
    this.inner.where(where);
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    this.inner.applyEagerLoad(query, alias);
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const hydrated = this.inner.hydrateEager(row, alias) as RelatedRecord[];
    return hydrated[0];
  }

  toExistsClause(parentTable: string): ExistsClause {
    return this.inner.toExistsClause(parentTable);
  }

  get(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      return plan.inner.first();
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      return plan.get();
    }, {});
  }

  count(): Promise<number> {
    return this.terminal(async (plan, _input) => {
      return plan.inner.count();
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        return _input.keyBy === undefined
          ? plan.inner.pluck(_input.column)
          : plan.inner.pluck(_input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        return plan.inner.value(_input.column);
      },
      { column },
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.terminal(
      async (plan, _input) => {
        return plan.inner.create(_input.attributes);
      },
      { attributes },
    );
  }
}

class MorphToRelationQuery<TChild extends object, ChildKey extends keyof TChild & string> {
  readonly kind: RelationKind = "morphTo";
  private extraWhere: QueryWhere<Record<string, unknown>>[] = [];

  constructor(
    private readonly parent: RelationHost<TChild, ChildKey>,
    private readonly relatedByType: Record<
      string,
      RelatedModelClass<Record<string, unknown>, "id">
    >,
    readonly relation: MorphToRelation<TChild, keyof TChild & string, keyof TChild & string>,
  ) {}

  snapshot() {
    const copy = new MorphToRelationQuery(
      snapshotHost(this.parent),
      { ...this.relatedByType },
      snapshotQueryPlan(this.relation),
    );
    copy.extraWhere = snapshotQueryPlan(this.extraWhere);
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<Record<string, unknown>>): this {
    this.extraWhere.push({ ...where });
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TChild, ChildKey>, alias: string): void {
    const repositories = new Map(
      Object.entries(this.relatedByType).map(([type, model]) => [
        type,
        model.repository() as never,
      ]),
    );
    query.withMorphTo(
      alias,
      this.relation,
      repositories,
      {},
      new Map(
        Object.entries(this.relatedByType).map(([type, model]) => [
          type,
          relatedOptions(model, this.extraWhere),
        ]),
      ),
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string, forNestedLoading = false): unknown {
    const value = row[alias];
    // Flat morph-to eager results retain their existing plain-record shape.
    // Explicit nested paths need the concrete model's relation methods instead.
    if (!forNestedLoading || !value) return value;
    const type = row[this.relation.morphTypeKey];
    const related =
      type === undefined || type === null ? undefined : this.relatedByType[String(type)];
    return related ? related.newFromRecord(value as Record<string, unknown>) : value;
  }

  toExistsClause(parentTable: string): ExistsClause {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const params: unknown[] = [];
    const type = this.parent.get(this.relation.morphTypeKey);
    if (type !== undefined && type !== null && !this.relatedByType[String(type)]) {
      return { sql: "SELECT 1 WHERE 1 = 0", params };
    }
    const branches = Object.entries(this.relatedByType).map(([type, related]) => {
      params.push(type);
      const discriminator = dialect.placeholder(params.length);
      const table = related.repository().getTable();
      const extra = relatedConditions(dialect, related, this.extraWhere, {}, params, [parentTable]);
      return `(${qualifyColumn(dialect, parentTable, this.relation.morphTypeKey)} = ${discriminator} AND EXISTS (SELECT 1 FROM ${quoteIdentifier(dialect, table.name)}${extra.joins} WHERE ${qualifyColumn(dialect, table.name, table.primaryKey)} = ${qualifyColumn(dialect, parentTable, this.relation.morphIdKey)}${extra.sql}))`;
    });
    return {
      sql: `SELECT 1 WHERE ${branches.length > 0 ? branches.join(" OR ") : "1 = 0"}`,
      params,
    };
  }

  get(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      const related = plan.relatedForCurrentType();
      const query = plan.relatedQuery();

      if (!query) {
        return null;
      }

      const row = await query.first();
      return row ? (related?.newFromRecord(row) ?? null) : null;
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        return pluckFromQuery(plan.relatedQuery(), _input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        return plan.relatedQuery()?.value(_input.column) ?? null;
      },
      { column },
    );
  }

  private relatedForCurrentType(): RelatedModelClass<Record<string, unknown>, "id"> | undefined {
    const type = String(this.parent.get(this.relation.morphTypeKey) ?? "");
    return this.relatedByType[type];
  }

  private relatedQuery(): RepositoryQuery<Record<string, unknown>, "id"> | null {
    const id = this.parent.get(this.relation.morphIdKey);
    const related = this.relatedForCurrentType();

    if (!related || id === null || id === undefined) {
      return null;
    }

    const table = related.repository().getTable();
    return relatedRead(
      related,
      getRepositoryBinding(this.parent.getRepository()).session,
      asWhere<Record<string, unknown>>({ [table.primaryKey]: id }),
      this.extraWhere,
    );
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await user.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }
}

class HasManyThroughRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TFar extends object,
  FarKey extends keyof TFar & string,
> {
  readonly kind: RelationKind = "hasManyThrough";
  private extraWhere: QueryWhere<TFar>[] = [];
  private extraOptions: Omit<QueryOptions<TFar>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TFar, FarKey>,
    readonly relation: HasManyThroughRelation<
      TParent,
      TFar,
      ParentKey,
      string,
      string,
      keyof TFar & string
    >,
  ) {}

  snapshot() {
    const copy = new HasManyThroughRelationQuery(
      snapshotHost(this.parent),
      this.related,
      snapshotQueryPlan(this.relation),
    );
    copy.extraWhere = snapshotQueryPlan(this.extraWhere);
    copy.extraOptions = snapshotQueryPlan(this.extraOptions);
    return copy;
  }

  private terminal<V, A = undefined>(
    work: (plan: ReturnType<this["snapshot"]>, input: A) => Promise<V>,
    input?: A,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.parent.getRepository());
    let plan: ReturnType<this["snapshot"]>;
    let captured: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot() as ReturnType<this["snapshot"]>;
      captured = snapshotQueryPlan(input as A);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, captured));
  }

  where(where: QueryWhere<TFar>): this {
    this.extraWhere.push({ ...where });
    return this;
  }

  orderBy(orderBy: QueryOptions<TFar>["orderBy"]): this {
    this.extraOptions = { ...this.extraOptions, orderBy };
    return this;
  }

  limit(limit: number): this {
    this.extraOptions = { ...this.extraOptions, limit };
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    query.withHasManyThrough(
      alias,
      this.relation,
      this.related.repository() as never,
      relatedOptions(this.related, this.extraWhere, this.extraOptions),
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TFar));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const dialect = getRepositoryBinding(this.parent.getRepository()).dialect;
    const farTable = this.related.repository().getTable().name;
    const extra = relatedConditions(
      dialect,
      this.related,
      this.extraWhere,
      this.extraOptions,
      [],
      [parentTable, this.relation.throughTable],
    );
    const sql = `SELECT 1 FROM ${quoteIdentifier(dialect, farTable)} INNER JOIN ${quoteIdentifier(dialect, this.relation.throughTable)} ON ${qualifyColumn(dialect, this.relation.throughTable, this.relation.secondLocalKey)} = ${qualifyColumn(dialect, farTable, this.relation.secondKey)}${extra.joins} WHERE ${qualifyColumn(dialect, this.relation.throughTable, this.relation.firstKey)} = ${qualifyColumn(dialect, parentTable, this.relation.localKey)}${extra.sql}`;
    return { sql, params: extra.params };
  }

  get(): Promise<RelatedRecord[]> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.farRows();
      return rows.map((row) => plan.related.newFromRecord(row as TFar));
    }, {});
  }

  first(): Promise<RelatedRecord | null> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.limit(1).get();
      return rows[0] ?? null;
    }, {});
  }

  count(): Promise<number> {
    return this.terminal(async (plan, _input) => {
      const rows = await plan.get();
      return rows.length;
    }, {});
  }

  async pluck(column: string): Promise<unknown[]>;
  async pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    return this.terminal(
      async (plan, _input) => {
        const rows = (await plan.farRows()) as Array<Record<string, unknown>>;
        return _input.keyBy === undefined
          ? projectPluck(rows, _input.column)
          : projectPluck(rows, _input.column, _input.keyBy);
      },
      { column, keyBy },
    );
  }

  value(column: string): Promise<unknown> {
    return this.terminal(
      async (plan, _input) => {
        const values = await plan.limit(1).pluck(_input.column);
        return values[0] ?? null;
      },
      { column },
    );
  }

  private async farRows(): Promise<TFar[]> {
    return this.related
      .repository()

      .findHasManyThrough(this.parent.get(this.relation.localKey), this.relation, {
        ...relatedOptions(this.related, this.extraWhere, this.extraOptions),
      });
  }

  // biome-ignore lint/suspicious/noThenProperty: relation queries are thenable (`await department.applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }
}

type AnyRelationQuery = {
  kind: RelationKind;
  snapshot(): AnyRelationQuery;
  applyEagerLoad(query: unknown, alias: string): void;
  hydrateEager(row: Record<string, unknown>, alias: string, forNestedLoading?: boolean): unknown;
  get(): Promise<unknown>;
  toExistsClause(parentTable: string): ExistsClause;
  where?(where: Record<string, unknown>): unknown;
  then?: (
    onfulfilled?: ((value: unknown) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ) => Promise<unknown>;
};

export type { AnyRelationQuery, RelatedModelClass, RelatedRecord, RelationHost };
export {
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  HasManyRelationQuery,
  HasManyThroughRelationQuery,
  HasOneRelationQuery,
  MorphManyRelationQuery,
  MorphOneRelationQuery,
  MorphToRelationQuery,
};
