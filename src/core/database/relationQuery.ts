import type BaseRepository from "./baseRepository.ts";
import type {
  BelongsToManyRelation,
  BelongsToRelation,
  HasManyRelation,
  HasOneRelation,
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

type RelationKind = "hasMany" | "hasOne" | "belongsTo" | "belongsToMany";

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
    return row[alias] ?? [];
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
    return (await this.get()).length;
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.related.create(attributes, {
      [this.relation.foreignKey]: this.parent.get(this.relation.localKey),
    });
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
    const value = row[alias];
    return Array.isArray(value) ? (value[0] ?? undefined) : value;
  }

  async get(): Promise<RelatedRecord | null> {
    return this.inner.limit(1).first();
  }

  async first(): Promise<RelatedRecord | null> {
    return this.get();
  }

  async count(): Promise<number> {
    return (await this.get()) ? 1 : 0;
  }

  async create(attributes: Record<string, unknown> = {}): Promise<RelatedRecord> {
    return this.inner.create(attributes);
  }
}

class BelongsToRelationQuery<
  TChild extends object,
  ChildKey extends keyof TChild & string,
  TParent extends object,
  ParentKey extends keyof TParent & string,
> {
  readonly kind: RelationKind = "belongsTo";
  private extraOptions: Omit<QueryOptions<TParent>, "where"> = {};

  constructor(
    private readonly parent: RelationHost<TChild, ChildKey>,
    private readonly related: RelatedModelClass<TParent, ParentKey>,
    readonly relation: BelongsToRelation<TChild, TParent, keyof TChild & string, ParentKey>,
  ) {}

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
    return row[alias];
  }

  async get(): Promise<RelatedRecord | null> {
    const foreign = this.parent.get(this.relation.foreignKey);

    if (foreign === null || foreign === undefined) {
      return null;
    }

    const repository = this.related
      .repository()
      .withConnection(this.parent.getRepository().getConnection());
    let query = repository.query(asWhere<TParent>({ [this.relation.ownerKey]: foreign }));

    if (this.extraOptions.orderBy) {
      query = query.orderBy(this.extraOptions.orderBy);
    }

    const row = await query.first();
    return row ? this.related.newFromRecord(row as TParent) : null;
  }

  async first(): Promise<RelatedRecord | null> {
    return this.get();
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

  applyEagerLoad(_query: RepositoryQuery<TParent, ParentKey>, _alias: string): void {
    // Pivot eager-load is applied per parent in Model.with() via get().
  }

  hydrateEager(row: Record<string, unknown>, alias: string): unknown {
    return row[alias] ?? [];
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
    return (await this.get()).length;
  }

  async attach(ids: unknown | readonly unknown[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const parentId = this.parent.get(this.relation.parentKey);

    for (const id of list) {
      await this.connection().unsafe(
        `INSERT INTO ${this.relation.pivotTable} (${String(this.relation.foreignPivotKey)}, ${String(this.relation.relatedPivotKey)}) VALUES ($1, $2)`,
        [parentId, id],
      );
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
    await this.connection().unsafe(
      `DELETE FROM ${this.relation.pivotTable} WHERE ${String(this.relation.foreignPivotKey)} = $1 AND ${String(this.relation.relatedPivotKey)} = ANY($2)`,
      [parentId, list],
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

type AnyRelationQuery = {
  kind: RelationKind;
  applyEagerLoad(query: unknown, alias: string): void;
  hydrateEager(row: Record<string, unknown>, alias: string): unknown;
  get(): Promise<unknown>;
};

export type { AnyRelationQuery, RelatedModelClass, RelatedRecord, RelationHost };
export {
  BelongsToManyRelationQuery,
  BelongsToRelationQuery,
  HasManyRelationQuery,
  HasOneRelationQuery,
};
