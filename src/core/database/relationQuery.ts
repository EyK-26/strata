import type BaseRepository from "./baseRepository.ts";
import { buildAdvancedWhereClause, qualifyColumn, quoteIdentifier } from "./query.ts";
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
import type { QueryOptions, QueryWhere } from "./types.ts";

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

class HasManyRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "hasMany";
  private extraWhere: QueryWhere<TChild> = {};
  private extraOptions: Omit<QueryOptions<TChild>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TParent, ParentKey>,
    private readonly related: RelatedModelClass<TChild, ChildKey>,
    readonly relation: HasManyRelation<TParent, TChild, ParentKey, keyof TChild & string>,
  ) {}

  where(where: QueryWhere<TChild>): this {
    this.extraWhere = { ...this.extraWhere, ...where };
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
    query.withHasMany(alias, this.relation, this.related.repository() as never, this.extraOptions);
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TChild));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const childTable = this.related.repository().getTable().name;
    const extra = buildAdvancedWhereClause(childTable, this.extraWhere, [], []);
    const extraSql = extra.clause.replace(/^ WHERE /, "");
    const sql = `SELECT 1 FROM ${quoteIdentifier(childTable)} WHERE ${qualifyColumn(childTable, this.relation.foreignKey)} = ${qualifyColumn(parentTable, this.relation.localKey)}${extraSql ? ` AND ${extraSql}` : ""}`;
    return { sql, params: extra.params };
  }

  private scopedQuery(): RepositoryQuery<TChild, ChildKey> {
    const repository = this.related
      .repository()
      .withConnection(this.parent.getRepository().getConnection());
    let query = repository.query(
      asWhere<TChild>({
        [this.relation.foreignKey]: this.parent.get(this.relation.localKey),
        ...this.extraWhere,
      }),
    );

    if (this.extraOptions.orderBy) {
      query = query.orderBy(this.extraOptions.orderBy);
    }

    if (this.extraOptions.limit !== undefined) {
      query = query.limit(this.extraOptions.limit);
    }

    return query;
  }

  async get(): Promise<RelatedRecord[]> {
    const rows = await this.scopedQuery().get();
    return rows.map((row) => this.related.newFromRecord(row as TChild));
  }

  async first(): Promise<RelatedRecord | null> {
    const rows = await this.limit(1).get();
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    return this.scopedQuery().count();
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.related.create(attributes, {
      [this.relation.foreignKey]: this.parent.get(this.relation.localKey),
    });
  }

  async save(
    related:
      | RelatedRecord
      | (Record<string, unknown> & {
          save?: () => Promise<unknown>;
          mergeAttributes?: (patch: Record<string, unknown>) => unknown;
        }),
  ): Promise<RelatedRecord> {
    const forced = {
      [this.relation.foreignKey]: this.parent.get(this.relation.localKey),
    };

    const savable = related as {
      save?: () => Promise<unknown>;
      mergeAttributes?: (patch: Record<string, unknown>) => unknown;
    };
    if (typeof savable.save === "function") {
      savable.mergeAttributes?.(forced);
      await savable.save();
      return related as RelatedRecord;
    }

    return this.create(related as Record<string, unknown>);
  }

  async createMany(records: ReadonlyArray<Record<string, unknown>>): Promise<RelatedRecord[]> {
    const created: RelatedRecord[] = [];

    for (const attributes of records) {
      created.push(await this.create(attributes));
    }

    return created;
  }
}

class HasOneRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "hasOne";
  private readonly inner: HasManyRelationQuery<TParent, ParentKey, TChild, ChildKey>;

  constructor(
    parent: RelationHost<TParent, ParentKey>,
    related: RelatedModelClass<TChild, ChildKey>,
    readonly relation: HasOneRelation<TParent, TChild, ParentKey, keyof TChild & string>,
  ) {
    this.inner = new HasManyRelationQuery(parent, related, {
      type: "hasMany",
      name: relation.name,
      localKey: relation.localKey,
      foreignKey: relation.foreignKey,
    });
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
    this.inner.limit(1).applyEagerLoad(query, alias);
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const hydrated = this.inner.hydrateEager(row, alias) as RelatedRecord[];
    return hydrated[0];
  }

  toExistsClause(parentTable: string): ExistsClause {
    return this.inner.toExistsClause(parentTable);
  }

  async get(): Promise<RelatedRecord | null> {
    return this.inner.limit(1).first();
  }

  async first(): Promise<RelatedRecord | null> {
    return this.get();
  }

  async count(): Promise<number> {
    return this.inner.count();
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.inner.create(attributes);
  }

  async save(related: RelatedRecord | Record<string, unknown>): Promise<RelatedRecord> {
    return this.inner.save(related);
  }
}

class BelongsToRelationQuery<
  TChild extends object,
  ChildKey extends keyof TChild & string,
  TParent extends object,
  ParentKey extends keyof TParent & string,
> {
  readonly kind: RelationKind = "belongsTo";
  private extraWhere: QueryWhere<TParent> = {};
  private extraOptions: Omit<QueryOptions<TParent>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TChild, ChildKey>,
    private readonly related: RelatedModelClass<TParent, ParentKey>,
    readonly relation: BelongsToRelation<TChild, TParent, keyof TChild & string, ParentKey>,
  ) {}

  where(where: QueryWhere<TParent>): this {
    this.extraWhere = { ...this.extraWhere, ...where };
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
      this.extraOptions,
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias];
    return value ? this.related.newFromRecord(value as TParent) : value;
  }

  toExistsClause(parentTable: string): ExistsClause {
    const relatedTable = this.related.repository().getTable().name;
    const extra = buildAdvancedWhereClause(relatedTable, this.extraWhere, [], []);
    const extraSql = extra.clause.replace(/^ WHERE /, "");
    const sql = `SELECT 1 FROM ${quoteIdentifier(relatedTable)} WHERE ${qualifyColumn(relatedTable, this.relation.ownerKey)} = ${qualifyColumn(parentTable, this.relation.foreignKey)}${extraSql ? ` AND ${extraSql}` : ""}`;
    return { sql, params: extra.params };
  }

  async get(): Promise<RelatedRecord | null> {
    const foreign = this.parent.get(this.relation.foreignKey);

    if (foreign === null || foreign === undefined) {
      return null;
    }

    const repository = this.related
      .repository()
      .withConnection(this.parent.getRepository().getConnection());
    let query = repository.query(
      asWhere<TParent>({ [this.relation.ownerKey]: foreign, ...this.extraWhere }),
    );

    if (this.extraOptions.orderBy) {
      query = query.orderBy(this.extraOptions.orderBy);
    }

    const row = await query.first();
    return row ? this.related.newFromRecord(row as TParent) : null;
  }

  async first(): Promise<RelatedRecord | null> {
    return this.get();
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  async associate(owner: { id?: unknown } | RelatedRecord): Promise<void> {
    await this.parent.getRepository().updateById(this.parent.id, {
      [this.relation.foreignKey]: ownerId(owner, this.relation.ownerKey),
    } as never);
  }

  async dissociate(): Promise<void> {
    await this.parent.getRepository().updateById(this.parent.id, {
      [this.relation.foreignKey]: null,
    } as never);
  }
}

class BelongsToManyRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TRelated extends object,
  RelatedKey extends keyof TRelated & string,
  Pivot extends object,
> {
  readonly kind: RelationKind = "belongsToMany";
  private extraWhere: QueryWhere<TRelated> = {};
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

  where(where: QueryWhere<TRelated>): this {
    this.extraWhere = { ...this.extraWhere, ...where };
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
      this.extraOptions,
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
    const relatedTable = this.related.repository().getTable().name;
    const extra = buildAdvancedWhereClause(relatedTable, this.extraWhere, [], []);
    const extraSql = extra.clause.replace(/^ WHERE /, "");
    const sql = `SELECT 1 FROM ${quoteIdentifier(relatedTable)} INNER JOIN ${quoteIdentifier(this.relation.pivotTable)} ON ${qualifyColumn(this.relation.pivotTable, this.relation.relatedPivotKey)} = ${qualifyColumn(relatedTable, this.relation.relatedKey)} WHERE ${qualifyColumn(this.relation.pivotTable, this.relation.foreignPivotKey)} = ${qualifyColumn(parentTable, this.relation.parentKey)}${extraSql ? ` AND ${extraSql}` : ""}`;
    return { sql, params: extra.params };
  }

  private connection() {
    return this.parent.getRepository().getConnection();
  }

  async get(): Promise<RelatedRecord[]> {
    const parentId = this.parent.get(this.relation.parentKey);
    const pivotRows = await this.connection().unsafe<Pivot>(
      `SELECT * FROM ${this.relation.pivotTable} WHERE ${String(this.relation.foreignPivotKey)} = $1`,
      [parentId],
    );

    if (pivotRows.length === 0) {
      return [];
    }

    const relatedIds = [
      ...new Set(
        pivotRows.map(
          (row) => row[this.relation.relatedPivotKey] as unknown as TRelated[RelatedKey],
        ),
      ),
    ];
    const repository = this.related.repository().withConnection(this.connection());
    const rows = await repository.findAll({
      ...this.extraOptions,
      where: asWhere<TRelated>({
        [this.relation.relatedKey]: relatedIds,
        ...this.extraWhere,
      }),
    });

    return rows.map((row) => this.related.newFromRecord(row));
  }

  async first(): Promise<RelatedRecord | null> {
    const rows = await this.get();
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const parentId = this.parent.get(this.relation.parentKey);
    const rows = await this.connection().unsafe<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM ${this.relation.pivotTable} WHERE ${String(this.relation.foreignPivotKey)} = $1`,
      [parentId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  async attach(ids: unknown | readonly unknown[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const parentId = this.parent.get(this.relation.parentKey);
    const extraKeys = Object.keys(this.pivotValues);
    const extraColumns = extraKeys.length > 0 ? `, ${extraKeys.join(", ")}` : "";
    const extraPlaceholders = extraKeys.map((_, index) => `$${index + 3}`).join(", ");
    const extraValues = extraKeys.map((key) => this.pivotValues[key]);

    for (const id of list) {
      await this.connection().unsafe(
        extraKeys.length > 0
          ? `INSERT INTO ${this.relation.pivotTable} (${String(this.relation.foreignPivotKey)}, ${String(this.relation.relatedPivotKey)}${extraColumns}) VALUES ($1, $2, ${extraPlaceholders})`
          : `INSERT INTO ${this.relation.pivotTable} (${String(this.relation.foreignPivotKey)}, ${String(this.relation.relatedPivotKey)}) VALUES ($1, $2)`,
        [parentId, id, ...extraValues],
      );
    }
  }

  async toggle(ids: unknown | readonly unknown[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const parentId = this.parent.get(this.relation.parentKey);

    for (const id of list) {
      const existing = await this.connection().unsafe(
        `SELECT 1 FROM ${this.relation.pivotTable} WHERE ${String(this.relation.foreignPivotKey)} = $1 AND ${String(this.relation.relatedPivotKey)} = $2 LIMIT 1`,
        [parentId, id],
      );

      if (existing.length > 0) {
        await this.detach(id);
      } else {
        await this.attach(id);
      }
    }
  }

  async detach(ids?: unknown | readonly unknown[]): Promise<void> {
    const parentId = this.parent.get(this.relation.parentKey);

    if (ids === undefined) {
      await this.connection().unsafe(
        `DELETE FROM ${this.relation.pivotTable} WHERE ${String(this.relation.foreignPivotKey)} = $1`,
        [parentId],
      );
      return;
    }

    const list = Array.isArray(ids) ? ids : [ids];
    const placeholders = list.map((_, index) => `$${index + 2}`).join(", ");
    await this.connection().unsafe(
      `DELETE FROM ${this.relation.pivotTable} WHERE ${String(this.relation.foreignPivotKey)} = $1 AND ${String(this.relation.relatedPivotKey)} IN (${placeholders})`,
      [parentId, ...list],
    );
  }

  async sync(ids: readonly unknown[]): Promise<void> {
    await this.detach();

    if (ids.length > 0) {
      await this.attach(ids);
    }
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    const related = await this.related.create(attributes);
    await this.attach(related.id);
    return related;
  }
}

class MorphManyRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "morphMany";
  private extraWhere: QueryWhere<TChild> = {};
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

  where(where: QueryWhere<TChild>): this {
    this.extraWhere = { ...this.extraWhere, ...where };
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TParent, ParentKey>, alias: string): void {
    query.withMorphMany(
      alias,
      this.relation,
      this.related.repository() as never,
      this.extraOptions,
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TChild));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const childTable = this.related.repository().getTable().name;
    const extra = buildAdvancedWhereClause(
      childTable,
      {
        [this.relation.morphTypeKey]: this.relation.morphType,
        ...this.extraWhere,
      } as QueryWhere<TChild>,
      [],
      [],
    );
    const extraSql = extra.clause.replace(/^ WHERE /, "");
    const sql = `SELECT 1 FROM ${quoteIdentifier(childTable)} WHERE ${qualifyColumn(childTable, this.relation.morphIdKey)} = ${qualifyColumn(parentTable, this.relation.localKey)}${extraSql ? ` AND ${extraSql}` : ""}`;
    return { sql, params: extra.params };
  }

  async get(): Promise<RelatedRecord[]> {
    const repository = this.related
      .repository()
      .withConnection(this.parent.getRepository().getConnection());
    const rows = await repository
      .query(
        asWhere<TChild>({
          [this.relation.morphTypeKey]: this.relation.morphType,
          [this.relation.morphIdKey]: this.parent.get(this.relation.localKey),
          ...this.extraWhere,
        }),
      )
      .get();
    return rows.map((row) => this.related.newFromRecord(row as TChild));
  }

  async first(): Promise<RelatedRecord | null> {
    const rows = await this.get();
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const repository = this.related
      .repository()
      .withConnection(this.parent.getRepository().getConnection());
    return repository
      .query(
        asWhere<TChild>({
          [this.relation.morphTypeKey]: this.relation.morphType,
          [this.relation.morphIdKey]: this.parent.get(this.relation.localKey),
          ...this.extraWhere,
        }),
      )
      .count();
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.related.create(attributes, {
      [this.relation.morphTypeKey]: this.relation.morphType,
      [this.relation.morphIdKey]: this.parent.get(this.relation.localKey),
    });
  }
}

class MorphOneRelationQuery<
  TParent extends object,
  ParentKey extends keyof TParent & string,
  TChild extends object,
  ChildKey extends keyof TChild & string,
> {
  readonly kind: RelationKind = "morphOne";
  private readonly inner: MorphManyRelationQuery<TParent, ParentKey, TChild, ChildKey>;

  constructor(
    parent: RelationHost<TParent, ParentKey>,
    related: RelatedModelClass<TChild, ChildKey>,
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

  async get(): Promise<RelatedRecord | null> {
    return this.inner.first();
  }

  async first(): Promise<RelatedRecord | null> {
    return this.get();
  }

  async count(): Promise<number> {
    return this.inner.count();
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord | null) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.inner.create(attributes);
  }
}

class MorphToRelationQuery<TChild extends object, ChildKey extends keyof TChild & string> {
  readonly kind: RelationKind = "morphTo";
  private extraWhere: QueryWhere<Record<string, unknown>> = {};

  constructor(
    private readonly parent: RelationHost<TChild, ChildKey>,
    private readonly relatedByType: Record<
      string,
      RelatedModelClass<Record<string, unknown>, "id">
    >,
    readonly relation: MorphToRelation<TChild, keyof TChild & string, keyof TChild & string>,
  ) {}

  where(where: QueryWhere<Record<string, unknown>>): this {
    this.extraWhere = { ...this.extraWhere, ...where };
    return this;
  }

  applyEagerLoad(query: RepositoryQuery<TChild, ChildKey>, alias: string): void {
    const repositories = new Map(
      Object.entries(this.relatedByType).map(([type, model]) => [
        type,
        model.repository() as never,
      ]),
    );
    query.withMorphTo(alias, this.relation, repositories);
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    return row[alias];
  }

  toExistsClause(parentTable: string): ExistsClause {
    const type = String(this.parent.get(this.relation.morphTypeKey) ?? "");
    const related = this.relatedByType[type];
    if (!related) {
      return { sql: "SELECT 1 WHERE 1 = 0", params: [] };
    }

    const relatedTable = related.repository().getTable();
    const extra = buildAdvancedWhereClause(relatedTable.name, this.extraWhere, [], []);
    const extraSql = extra.clause.replace(/^ WHERE /, "");
    return {
      sql: `SELECT 1 FROM ${quoteIdentifier(relatedTable.name)} WHERE ${qualifyColumn(relatedTable.name, relatedTable.primaryKey)} = ${qualifyColumn(parentTable, this.relation.morphIdKey)}${extraSql ? ` AND ${extraSql}` : ""}`,
      params: extra.params,
    };
  }

  async get(): Promise<RelatedRecord | null> {
    const type = String(this.parent.get(this.relation.morphTypeKey) ?? "");
    const id = this.parent.get(this.relation.morphIdKey);
    const related = this.relatedByType[type];

    if (!related || id === null || id === undefined) {
      return null;
    }

    const table = related.repository().getTable();
    const row = await related
      .repository()
      .withConnection(this.parent.getRepository().getConnection())
      .query(asWhere<object>({ [table.primaryKey]: id, ...this.extraWhere }))
      .first();
    return row ? related.newFromRecord(row) : null;
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $user->applications()`).
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
  private extraWhere: QueryWhere<TFar> = {};
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

  where(where: QueryWhere<TFar>): this {
    this.extraWhere = { ...this.extraWhere, ...where };
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
      this.extraOptions,
    );
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    const value = row[alias] ?? [];
    const rows = Array.isArray(value) ? value : [];
    return rows.map((item) => this.related.newFromRecord(item as TFar));
  }

  toExistsClause(parentTable: string): ExistsClause {
    const farTable = this.related.repository().getTable().name;
    const extra = buildAdvancedWhereClause(farTable, this.extraWhere, [], []);
    const extraSql = extra.clause.replace(/^ WHERE /, "");
    const sql = `SELECT 1 FROM ${quoteIdentifier(farTable)} INNER JOIN ${quoteIdentifier(this.relation.throughTable)} ON ${qualifyColumn(this.relation.throughTable, this.relation.secondLocalKey)} = ${qualifyColumn(farTable, this.relation.secondKey)} WHERE ${qualifyColumn(this.relation.throughTable, this.relation.firstKey)} = ${qualifyColumn(parentTable, this.relation.localKey)}${extraSql ? ` AND ${extraSql}` : ""}`;
    return { sql, params: extra.params };
  }

  async get(): Promise<RelatedRecord[]> {
    const rows = await this.related
      .repository()
      .withConnection(this.parent.getRepository().getConnection())
      .findHasManyThrough(this.parent.get(this.relation.localKey), this.relation, {
        ...this.extraOptions,
        where: this.extraWhere,
      });
    return rows.map((row) => this.related.newFromRecord(row as TFar));
  }

  async first(): Promise<RelatedRecord | null> {
    const rows = await this.limit(1).get();
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const rows = await this.get();
    return rows.length;
  }

  // biome-ignore lint/suspicious/noThenProperty: Laravel relation queries are thenable (`await $department->applications()`).
  then(
    onfulfilled?: ((value: RelatedRecord[]) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): Promise<unknown> {
    return thenGet(() => this.get(), onfulfilled, onrejected);
  }
}

type AnyRelationQuery = {
  kind: RelationKind;
  applyEagerLoad(query: unknown, alias: string): void;
  hydrateEager(row: Record<string, unknown>, alias: string): unknown;
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
