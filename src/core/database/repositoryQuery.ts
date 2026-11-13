import type {
  AnyRepositoryDefinition,
  RepositoryDefinition,
} from "@getstrata/core/database/definitions";
import { getBindingPorts } from "#strata-orm-internal";
import type { KeysetOptions, PaginatedResult } from "../pagination/index.ts";
import type BaseRepository from "./baseRepository.ts";
import { getRepositoryBinding } from "./baseRepository.ts";
import { projectPluck, uniqueColumnSelect } from "./pluck.ts";
import { parseQualifiedColumn } from "./query.ts";
import { snapshotQueryPlan } from "./queryPlanSnapshot";
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
import type {
  QueryJoin,
  QueryLockOptions,
  QueryOptions,
  QueryWhere,
  UpdateValues,
} from "./types.ts";
import { WhereBuilder, type WhereNode } from "./whereBuilder.ts";

type LoadedRow = Record<string, unknown>;

// Each registration retains its relation kind; only the heterogeneous related
// record/repository types are erased at the private storage boundary.
type StoredRelations<TEntity extends object> = {
  hasMany: HasManyRelation<TEntity, LoadedRow, keyof TEntity & string, string>;
  belongsTo: BelongsToRelation<TEntity, LoadedRow, keyof TEntity & string, string>;
  belongsToMany: BelongsToManyRelation<
    TEntity,
    LoadedRow,
    LoadedRow,
    keyof TEntity & string,
    string,
    string,
    string
  >;
  hasManyThrough: HasManyThroughRelation<
    TEntity,
    LoadedRow,
    keyof TEntity & string,
    string,
    string,
    string
  >;
  morphMany: MorphManyRelation<TEntity, LoadedRow, keyof TEntity & string, string, string>;
  morphOne: MorphOneRelation<TEntity, LoadedRow, keyof TEntity & string, string, string>;
  morphTo: MorphToRelation<TEntity, keyof TEntity & string, keyof TEntity & string>;
};

type StoredRepository = BaseRepository<LoadedRow, string>;
type StoredOptions = Omit<QueryOptions<LoadedRow>, "where">;

type StoredEagerLoad<TEntity extends object> = {
  [Kind in keyof StoredRelations<TEntity>]: {
    kind: Kind;
    as: string;
    relation: StoredRelations<TEntity>[Kind];
    repository: AnyRepositoryDefinition;
    options?: StoredOptions;
    morphOptions?: ReadonlyMap<string, QueryOptions<LoadedRow>>;
    morphRepositories?: ReadonlyMap<string, AnyRepositoryDefinition>;
  };
}[keyof StoredRelations<TEntity>];

let snapshotRepositoryQuery: <R extends object, K extends keyof R & string>(
  query: RepositoryQuery<R, K>,
) => RepositoryQuery<R, K>;

class RepositoryQuery<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  static {
    snapshotRepositoryQuery = <R extends object, K extends keyof R & string>(
      query: RepositoryQuery<R, K>,
    ): RepositoryQuery<R, K> => {
      getBindingPorts(getRepositoryBinding(query.repository)).assertActive();
      return query.snapshot();
    };
  }

  private readonly eagerLoads: StoredEagerLoad<TEntity>[] = [];
  private readonly whereNodes: WhereNode<TEntity>[] = [];
  private readonly protectedWhere: WhereNode<TEntity>[] = [];

  constructor(
    private readonly repository: BaseRepository<TEntity, PrimaryKey>,
    private whereClause: QueryWhere<TEntity> = {},
    private queryOptions: Omit<QueryOptions<TEntity>, "where"> = {},
  ) {}

  where(input: QueryWhere<TEntity> | ((builder: WhereBuilder<TEntity>) => void)): this {
    if (typeof input === "function") {
      const builder = new WhereBuilder<TEntity>();
      input(builder);
      if (builder.nodes.length > 0) this.whereNodes.push({ kind: "and", group: builder.nodes });
      return this;
    }

    this.whereNodes.push({ kind: "and", where: { ...input } });
    return this;
  }

  /** Preserve completed scope predicates separately from subsequent caller OR conditions. */
  protectWhere(): this {
    const nodes: WhereNode<TEntity>[] = [];
    if (Object.keys(this.whereClause).length > 0) {
      nodes.push({ kind: "and", where: this.whereClause });
    }
    nodes.push(...this.whereNodes);
    if (nodes.length > 0) this.protectedWhere.push({ kind: "and", group: nodes });
    this.whereClause = {};
    this.whereNodes.length = 0;
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

  lockForUpdate(options: QueryLockOptions = {}): this {
    this.queryOptions = {
      ...this.queryOptions,
      lock: {
        ...options,
        of: options.of ? [...options.of] : undefined,
        mode: "update",
      },
    };
    return this;
  }

  sharedLock(options: QueryLockOptions = {}): this {
    this.queryOptions = {
      ...this.queryOptions,
      lock: {
        ...options,
        of: options.of ? [...options.of] : undefined,
        mode: "share",
      },
    };
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

  whereNotIn(column: keyof TEntity & string, values: readonly unknown[]): this {
    return this.where({ [column]: { notIn: values } } as QueryWhere<TEntity>);
  }

  withSubqueryCount(alias: string, sql: string, params: readonly unknown[] = []): this {
    const table = this.repository.getTable();
    const existing =
      this.queryOptions.select ??
      table.columns.map((column) => ({
        kind: "column" as const,
        table: table.name,
        column,
      }));

    this.queryOptions = {
      ...this.queryOptions,
      select: [...existing, { kind: "subqueryCount", sql, params, as: alias }],
    };

    return this;
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
      relation,
      repository: this.relatedDefinition(childRepository),
      options: options as StoredOptions,
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
      relation,
      repository: this.relatedDefinition(parentRepository),
      options: options as StoredOptions,
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
      relation,
      repository: this.relatedDefinition(childRepository),
      options: options as StoredOptions,
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
      relation,
      repository: this.relatedDefinition(childRepository),
      options: options as StoredOptions,
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
    optionsByType?: ReadonlyMap<string, QueryOptions<TParent>>,
  ): this {
    this.eagerLoads.push({
      kind: "morphTo",
      morphOptions: optionsByType as ReadonlyMap<string, QueryOptions<LoadedRow>> | undefined,
      as,
      relation,
      repository: this.relatedDefinition(this.repository),
      morphRepositories: new Map(
        [...repositoriesByType].map(([type, repository]) => [
          type,
          this.relatedDefinition(repository),
        ]),
      ),
      options: options as StoredOptions,
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
      relation,
      repository: this.relatedDefinition(relatedRepository),
      options: options as StoredOptions,
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
      relation,
      repository: this.relatedDefinition(farRepository),
      options: options as StoredOptions,
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

  update(changes: UpdateValues<TEntity, PrimaryKey>): Promise<number> {
    return this.runTerminal([changes] as [typeof changes], async (plan, changes) => {
      plan.assertNoMutationEagerLoads();
      return plan.repository.updateWhere(changes, plan.buildOptions());
    });
  }

  updateReturning<K extends keyof TEntity & string>(
    changes: UpdateValues<TEntity, PrimaryKey>,
    ...columns: K[]
  ): Promise<Pick<TEntity, K>[]> {
    return this.runTerminal(
      [changes, columns] as [typeof changes, typeof columns],
      async (plan, changes, columns) => {
        plan.assertNoMutationEagerLoads();
        return plan.repository.updateWhereReturning(changes, columns, plan.buildOptions());
      },
    );
  }

  delete(): Promise<number> {
    return this.runTerminal([] as [], async (plan) => {
      plan.assertNoMutationEagerLoads();
      return plan.repository.deleteWhere(plan.buildOptions());
    });
  }

  private assertNoMutationEagerLoads(): void {
    if (this.eagerLoads.length) throw new Error("Conditional writes do not support eager loading.");
  }

  get(): Promise<Array<TEntity & LoadedRow>> {
    return this.runTerminal([] as [], async (plan) => {
      const rows = await plan.repository.findAll(plan.buildOptions());
      return await plan.attach(rows);
    });
  }

  first(): Promise<(TEntity & LoadedRow) | null> {
    return this.runTerminal([] as [], async (plan) => {
      const rows = await plan.repository.findAll({
        ...plan.buildOptions(),
        limit: 1,
      });
      const attached = await plan.attach(rows);
      return attached[0] ?? null;
    });
  }

  sumBy<K extends keyof TEntity & string>(
    groupColumn: K,
    column: keyof TEntity & string,
  ): Promise<Array<{ value: TEntity[K] | null; sum: string | null }>> {
    return this.runTerminal(
      [groupColumn, column] as [typeof groupColumn, typeof column],
      async (plan, groupColumn, column) => {
        if (plan.eagerLoads.length)
          throw new TypeError("Grouped sums do not support eager loading.");
        return plan.repository.sumBy(groupColumn, column, plan.buildOptions());
      },
    );
  }

  count(): Promise<number> {
    return this.runTerminal([] as [], async (plan) => {
      return await plan.repository.count(plan.buildOptions());
    });
  }

  pluck<K extends keyof TEntity & string>(column: K): Promise<Array<TEntity[K]>>;
  pluck<K extends keyof TEntity & string, KK extends keyof TEntity & string>(
    column: K,
    keyBy: KK,
  ): Promise<Map<TEntity[KK], TEntity[K]>>;
  pluck<K extends keyof TEntity & string>(
    column: K,
    keyBy?: keyof TEntity & string,
  ): Promise<Array<TEntity[K]> | Map<TEntity[keyof TEntity & string], TEntity[K]>> {
    return this.runTerminal(
      [column, keyBy] as [typeof column, typeof keyBy],
      async (plan, column, keyBy) => {
        const rows = await plan.repository.findAll({
          ...plan.buildOptions(),
          select: uniqueColumnSelect(
            plan.repository.getTable().name,
            keyBy === undefined || keyBy === column ? [column] : [column, keyBy],
          ),
        });

        if (keyBy === undefined) {
          return projectPluck(rows, column);
        }

        return projectPluck(rows, column, keyBy);
      },
    );
  }

  value<K extends keyof TEntity & string>(column: K): Promise<TEntity[K] | null> {
    return this.runTerminal([column] as [typeof column], async (plan, column) => {
      const rows = await plan.repository.findAll({
        ...plan.buildOptions(),
        select: uniqueColumnSelect(plan.repository.getTable().name, [column]),
        limit: 1,
      });
      const row = rows[0];

      if (row === undefined) {
        return null;
      }

      return row[column];
    });
  }

  /** Plain selected records, never complete entities or hydrated models. */
  project<K extends keyof TEntity & string>(
    columns: readonly K[],
    limit?: number,
  ): Promise<Array<Pick<TEntity, K>>> {
    return this.runTerminal(
      [columns, limit] as [typeof columns, typeof limit],
      async (plan, columns, limit) => {
        if (columns.length === 0)
          throw new RangeError("A projection requires at least one column.");
        const table = plan.repository.getTable();
        for (const column of columns)
          if (!table.columns.includes(column))
            throw new TypeError(`Unknown projection column: ${column}`);
        return await plan.repository.findAll({
          ...plan.buildOptions(),
          ...(limit === undefined ? {} : { limit }),
          select: uniqueColumnSelect(table.name, columns),
        });
      },
    );
  }

  attachToRows(rows: readonly TEntity[]): Promise<Array<TEntity & LoadedRow>> {
    return this.runTerminal([rows] as [typeof rows], async (plan, rows) => {
      return await plan.attach(rows);
    });
  }

  paginate(options: { page: number; perPage: number }): Promise<PaginatedResult<TEntity>> {
    return this.runTerminal([options] as [typeof options], async (plan, options) => {
      const page = await plan.repository.paginate({
        ...plan.buildOptions(),
        page: options.page,
        perPage: options.perPage,
      });
      return { ...page, data: await plan.attach(page.data) };
    });
  }

  chunk(
    count: number,
    callback: (rows: Array<TEntity & LoadedRow>) => Promise<boolean | void>,
  ): Promise<void> {
    return this.runTerminal(
      [count, callback] as [typeof count, typeof callback],
      async (plan, count, callback) => {
        await plan.repository.chunk(
          count,
          async (rows) => callback(await plan.attach(rows)),
          plan.buildOptions(),
        );
      },
    );
  }

  cursorPaginate(options: { perPage: number; cursor?: TEntity[PrimaryKey] }) {
    return this.runTerminal([options] as [typeof options], async (plan, options) => {
      const page = await plan.repository.cursorPaginate({
        ...plan.buildOptions(),
        ...options,
      });
      return { ...page, data: await plan.attach(page.data) };
    });
  }

  keysetPaginate(options: KeysetOptions<TEntity>) {
    return this.runTerminal([options] as [typeof options], async (plan, options) => {
      const page = await plan.repository.keysetPaginate({
        ...plan.buildOptions(),
        ...options,
      });
      return { ...page, data: await plan.attach(page.data) };
    });
  }

  projectKeyset<K extends keyof TEntity & string>(
    columns: readonly K[],
    options: KeysetOptions<TEntity>,
  ) {
    return this.runTerminal(
      [columns, options] as [typeof columns, typeof options],
      async (plan, columns, options) => {
        if (
          !columns.length ||
          columns.some((column) => !plan.repository.getTable().columns.includes(column))
        )
          throw new TypeError("Keyset projections require declared columns.");
        const page = await plan.repository.keysetPaginate({
          ...plan.buildOptions(),
          ...options,
          select: uniqueColumnSelect(plan.repository.getTable().name, columns),
        });
        return { ...page, data: page.data as Array<Pick<TEntity, K>> };
      },
    );
  }

  /** Compiled query filters for batched relationship loaders. */
  getOptions(): QueryOptions<TEntity> {
    return snapshotQueryPlan(this.buildOptions());
  }

  private relatedDefinition<R extends object, K extends keyof R & string>(
    repository: BaseRepository<R, K>,
  ): AnyRepositoryDefinition {
    const owner = getBindingPorts(getRepositoryBinding(this.repository));
    const related = getBindingPorts(getRepositoryBinding(repository));
    owner.assertActive();
    related.assertActive();
    if (owner.app !== related.app || owner.pool !== related.pool || owner.branch !== related.branch)
      throw new TypeError("Eager repositories must belong to the exact same live session.");
    return related.definition;
  }

  private resolveRepository(definition: AnyRepositoryDefinition): StoredRepository {
    return getBindingPorts(getRepositoryBinding(this.repository)).repository(
      definition as unknown as RepositoryDefinition<LoadedRow, string, StoredRepository>,
    );
  }

  private snapshot(): RepositoryQuery<TEntity, PrimaryKey> {
    const plan = new RepositoryQuery(
      this.repository,
      snapshotQueryPlan(this.whereClause),
      snapshotQueryPlan(this.queryOptions),
    );
    plan.whereNodes.push(...snapshotQueryPlan(this.whereNodes));
    plan.protectedWhere.push(...snapshotQueryPlan(this.protectedWhere));
    // Definition identities are authority, and must never be copied as metadata.
    for (const load of this.eagerLoads)
      plan.eagerLoads.push({
        ...load,
        relation: snapshotQueryPlan(load.relation),
        options: snapshotQueryPlan(load.options),
        morphOptions: snapshotQueryPlan(load.morphOptions),
        morphRepositories: load.morphRepositories ? new Map(load.morphRepositories) : undefined,
      } as StoredEagerLoad<TEntity>);
    return plan;
  }

  private runTerminal<A extends unknown[], V>(
    args: A,
    work: (plan: RepositoryQuery<TEntity, PrimaryKey>, ...args: A) => V | Promise<V>,
  ): Promise<V> {
    const binding = getRepositoryBinding(this.repository);
    let plan: RepositoryQuery<TEntity, PrimaryKey>;
    let inputs: A;
    try {
      getBindingPorts(binding).assertActive();
      plan = this.snapshot();
      inputs = snapshotQueryPlan(args);
    } catch (error) {
      return binding.run(() => {
        throw error;
      });
    }
    return binding.run(() => work(plan, ...inputs));
  }

  private buildOptions(): QueryOptions<TEntity> & {
    whereNodes?: WhereNode<TEntity>[];
  } {
    if (this.protectedWhere.length === 0) {
      return {
        ...this.queryOptions,
        where: this.whereClause,
        whereNodes: this.whereNodes,
      };
    }
    return {
      ...this.queryOptions,
      where: {},
      whereNodes: [...this.protectedWhere, { kind: "and", group: [...this.whereNodes] }],
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
      const relation = load.relation;
      const grouped = await this.resolveRepository(load.repository).loadHasManyForParents(
        rows,
        relation,
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]) ?? [];
      }
      return;
    }

    if (load.kind === "morphMany") {
      const relation = load.relation;
      const grouped = await this.resolveRepository(load.repository).loadMorphManyForParents(
        rows,
        relation,
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]) ?? [];
      }
      return;
    }

    if (load.kind === "morphOne") {
      const relation = load.relation;
      const grouped = await this.resolveRepository(load.repository).loadMorphOneForParents(
        rows,
        relation,
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]);
      }
      return;
    }

    if (load.kind === "hasManyThrough") {
      const relation = load.relation;
      const grouped = await this.resolveRepository(load.repository).loadHasManyThroughForParents(
        rows,
        relation,
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.localKey]) ?? [];
      }
      return;
    }

    if (load.kind === "belongsToMany") {
      const relation = load.relation;
      const grouped = await this.repository.loadBelongsToManyForParents(
        rows,
        relation,
        this.resolveRepository(load.repository),
        load.options,
      );
      for (const row of result) {
        (row as LoadedRow)[load.as] = getByRelationKey(grouped, row[relation.parentKey]) ?? [];
      }
      return;
    }

    if (load.kind === "morphTo") {
      const relation = load.relation;
      // An ID is only unique within its morph type. Partition once before
      // batching so filtered/missing targets cannot borrow another type's row.
      const repositories = load.morphRepositories ?? new Map();
      const partitions = new Map<
        string,
        { rows: TEntity[]; targets: Array<TEntity & LoadedRow> }
      >();
      rows.forEach((row, index) => {
        const type = String(row[relation.morphTypeKey]);
        const target = result[index];
        if (!target || !repositories.has(type)) return;
        const partition = partitions.get(type) ?? { rows: [], targets: [] };
        partition.rows.push(row);
        partition.targets.push(target);
        partitions.set(type, partition);
      });
      await Promise.all(
        [...partitions.entries()].map(async ([type, partition]) => {
          const repository = repositories.get(type);
          if (!repository) return;
          const grouped = await this.repository.loadMorphToForChildren(
            partition.rows,
            relation,
            new Map([[type, this.resolveRepository(repository)]]),
            load.morphOptions?.get(type) ?? load.options,
          );
          for (const row of partition.targets) {
            (row as LoadedRow)[load.as] = getByRelationKey(
              grouped,
              row[relation.morphIdKey as keyof TEntity],
            );
          }
        }),
      );
      return;
    }

    const relation = load.relation;
    const grouped = await this.repository.loadBelongsToForParents(
      rows,
      relation,
      this.resolveRepository(load.repository),
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
export { RepositoryQuery, snapshotRepositoryQuery };
