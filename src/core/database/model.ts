import { isDeepStrictEqual } from "node:util";
import type {
  AnyModelDefinition,
  ModelBinding,
  ModelDefinition,
  ModelObserver,
  ModelState,
  RepositoryDefinition,
} from "@getstrata/core/database/definitions";
import { isUniqueConstraintError } from "@getstrata/core/database/errors";
import { NotFoundError } from "@getstrata/core/errors/http";
import { getBindingPorts } from "#strata-orm-internal";
import type { KeysetOptions } from "../pagination/index.ts";
import type BaseRepository from "./baseRepository.ts";
import { getRepositoryBinding } from "./baseRepository.ts";
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
  snapshotModelQuery,
} from "./modelQuery.ts";
import { quoteIdentifier, resolveSoftDeleteColumn } from "./query.ts";
import { snapshotQueryPlan } from "./queryPlanSnapshot.ts";
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
import type {
  ModelWhere,
  ModelWriteValues,
  MutationValues,
  QueryOptions,
  QueryWhere,
  UpdateValues,
} from "./types.ts";

type RelatedRef<
  TRelated extends object,
  RelatedKey extends keyof TRelated & string,
  M extends Model<TRelated, RelatedKey> = Model<TRelated, RelatedKey>,
> =
  | ModelDefinition<TRelated, RelatedKey, M>
  | string
  | (() => ModelDefinition<TRelated, RelatedKey, M>);

function accessorName(key: string): string {
  const pascal = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return `get${pascal.charAt(0).toUpperCase()}${pascal.slice(1)}Attribute`;
}

function resolveRelated<
  TRelated extends object,
  RelatedKey extends keyof TRelated & string,
  M extends Model<TRelated, RelatedKey>,
>(
  owner: Model<object, never>,
  related: RelatedRef<TRelated, RelatedKey, M>,
): RelatedModelClass<TRelated, RelatedKey> {
  return modelFacade(owner).resolveRelated(related) as RelatedModelClass<TRelated, RelatedKey>;
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
  return modelFacade(model).name;
}
function modelStatics(model: object): BoundModelFacade<Record<string, unknown>, "id", AnyModel> {
  return model as BoundModelFacade<Record<string, unknown>, "id", AnyModel>;
}

let inspectModelBinding: (
  entity: Model<object, never>,
) => ModelBinding<object, never, BaseRepository<object, never>>;
let inspectModelState: (entity: Model<object, never>) => ModelState<object>;
let acceptModelRecord: (entity: Model<object, never>, record: object) => void;
let saveRelatedModel: (entity: AnyModel, forced: LoadedAttributes) => Promise<AnyModel>;
function getModelBinding<R extends object, K extends keyof R & string>(
  entity: Model<R, K>,
): ModelBinding<R, K, BaseRepository<R, K>> {
  return inspectModelBinding(entity as never) as unknown as ModelBinding<
    R,
    K,
    BaseRepository<R, K>
  >;
}
function modelFacade(entity: object): BoundModelFacade<Record<string, unknown>, "id", AnyModel> {
  return new BoundModelFacade(getModelBinding(entity as AnyModel));
}
async function runObservers(
  entity: AnyModel,
  event: keyof ModelObserver<unknown>,
): Promise<boolean> {
  const binding = getModelBinding(entity);
  getBindingPorts(binding).assertActive();
  for (const observer of getBindingPorts(binding).observers) {
    const callback = observer[event];
    if (callback && (await callback.call(observer, entity)) === false) return false;
  }
  return true;
}

class Model<TEntity extends object, PrimaryKey extends keyof TEntity & string> {
  #attributes: TEntity;
  #originalAttributes: LoadedAttributes;
  #exists: boolean;
  #loadedRelations: Record<string, unknown> = {};
  #hiddenOverrides: string[];
  #visibleOverrides: string[] | undefined;
  #appended: string[];
  #binding: ModelBinding<TEntity, PrimaryKey, BaseRepository<TEntity, PrimaryKey>>;

  constructor(
    state: ModelState<TEntity>,
    binding: ModelBinding<TEntity, PrimaryKey, BaseRepository<TEntity, PrimaryKey>>,
  ) {
    this.#binding = binding;
    this.#attributes = snapshotAttributes(state.attributes as LoadedAttributes) as TEntity;
    this.#originalAttributes = snapshotAttributes(state.original as LoadedAttributes);
    this.#exists = state.exists;
    this.#hiddenOverrides = [...state.hidden];
    this.#visibleOverrides = state.visible === undefined ? undefined : [...state.visible];
    this.#appended = [...state.appends];
  }

  protected get attributes(): TEntity {
    return this.#attributes;
  }
  protected get repository(): BaseRepository<TEntity, PrimaryKey> {
    return this.#binding.repository;
  }

  static {
    inspectModelBinding = (entity) => entity.#binding as never;
    inspectModelState = (entity) => ({
      attributes: snapshotAttributes(entity.#attributes as LoadedAttributes),
      original: snapshotAttributes(entity.#originalAttributes),
      exists: entity.#exists,
      hidden: [...entity.#hiddenOverrides],
      visible: entity.#visibleOverrides === undefined ? undefined : [...entity.#visibleOverrides],
      appends: [...entity.#appended],
    });
    acceptModelRecord = (entity, record) => entity.#acceptPersistedAttributes(record);
    saveRelatedModel = (entity, forced) =>
      entity.#mutateSnapshot(forced, (attributes, id, values) => {
        getBindingPorts(entity.#binding).assertMutation(entity.#exists ? "updated" : "created");
        entity.#attributes = attributes;
        Object.assign(entity.#attributes, values);
        return entity.#save(id);
      });
  }

  #acceptPersistedAttributes(record: TEntity): void {
    const original = this.#originalAttributes;
    const beforeWrite = snapshotAttributes(this.#attributes as LoadedAttributes);
    const existed = this.#exists;
    let written = beforeWrite;
    // Admission precedes hydration and acceptance. Restoration touches only native
    // base state: subclass methods, casts and observers never run in finalization.
    getBindingPorts(this.#binding).registerRestore(() => {
      this.#attributes = {
        ...beforeWrite,
        ...changedAttributes(this.#attributes as LoadedAttributes, written),
      } as TEntity;
      this.#originalAttributes = original;
      this.#exists = existed;
      return undefined;
    });
    const hydrated = modelFacade(this).hydrateAttributes(record);
    written = snapshotAttributes(hydrated as LoadedAttributes);
    this.#attributes = hydrated;
    this.#originalAttributes = written;
    this.#exists = true;
  }

  getRepository(): BaseRepository<TEntity, PrimaryKey> {
    return this.repository;
  }

  get $exists(): boolean {
    return this.#exists;
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
    const ModelClass = modelFacade(this);
    const hidden = new Set([...(ModelClass.$hidden ?? []), ...this.#hiddenOverrides]);
    const visible = this.#visibleOverrides ?? ModelClass.$visible;
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

    for (const key of [...(ModelClass.$appends ?? []), ...this.#appended]) {
      const accessor = (this as unknown as Record<string, unknown>)[accessorName(key)];
      if (typeof accessor === "function") {
        data[key] = (accessor as () => unknown).call(this);
      }
    }

    for (const [name, value] of Object.entries(this.#loadedRelations)) {
      if (
        !hidden.has(name) &&
        (!visible || visible.includes(name) || this.#appended.includes(name))
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
    getBindingPorts(this.#binding).assertEditable(this);
    this.#hiddenOverrides.push(...keys);
    return this;
  }

  makeVisible(...keys: string[]): this {
    getBindingPorts(this.#binding).assertEditable(this);
    if (keys.length === 0) return this;
    this.#visibleOverrides ??= [];
    this.#visibleOverrides.push(...keys);
    return this;
  }

  append(...keys: string[]): this {
    getBindingPorts(this.#binding).assertEditable(this);
    this.#appended.push(...keys);
    return this;
  }

  protected primaryKey(): PrimaryKey {
    return this.repository.getTable().primaryKey as PrimaryKey;
  }

  #mutateSnapshot<A, V>(
    input: A,
    work: (attributes: TEntity, id: TEntity[PrimaryKey], captured: A) => V | Promise<V>,
  ): Promise<V> {
    getBindingPorts(this.#binding).assertEditable(this);
    let attributes: TEntity;
    let captured: A;
    try {
      attributes = snapshotAttributes(this.#attributes as LoadedAttributes) as TEntity;
      captured = snapshotQueryPlan(input);
    } catch (error) {
      return this.#binding.run(() => {
        throw error;
      });
    }
    const id = attributes[this.#binding.table.primaryKey];
    return getBindingPorts(this.#binding).mutate(this, () => work(attributes, id, captured));
  }

  save(): Promise<this> {
    return this.#mutateSnapshot(undefined, (attributes, id) => {
      getBindingPorts(this.#binding).assertMutation(this.#exists ? "updated" : "created");
      this.#attributes = attributes;
      return this.#save(id);
    });
  }

  async #save(targetId: TEntity[PrimaryKey]): Promise<this> {
    getBindingPorts(this.#binding).assertMutation(this.#exists ? "updated" : "created");
    const ModelClass = modelFacade(this);
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
      const dirty = changedAttributes(
        this.attributes as LoadedAttributes,
        this.#originalAttributes,
      );
      if (Object.keys(dirty).length === 0) {
        await runObservers(this as never, "saved");
        return this;
      }
      const changes = applyTimestampsOnUpdate(
        table.columns,
        await ModelClass.dehydrateAttributes(dirty),
        timestamps,
      ) as UpdateValues<TEntity, PrimaryKey>;
      const record = await this.repository.updateByIdOrThrow(targetId, changes);
      this.#acceptPersistedAttributes(record);
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
    this.#acceptPersistedAttributes(record);
    await runObservers(this as never, "created");
    await runObservers(this as never, "saved");
    return this;
  }

  update(changes: Partial<TEntity>): Promise<this> {
    return this.#mutateSnapshot(changes, (attributes, id, snapshot) => {
      getBindingPorts(this.#binding).assertMutation(this.#exists ? "updated" : "created");
      const ModelClass = modelFacade(this);
      const assignable = filterMassAssignable(
        ModelClass.$fillable,
        ModelClass.$guarded,
        snapshot as LoadedAttributes,
      );
      this.#attributes = attributes;
      Object.assign(this.#attributes, assignable);
      return this.#save(id);
    });
  }

  delete(): Promise<boolean> {
    return this.#mutateSnapshot(undefined, (_attributes, id) => this.#delete(id));
  }

  async #delete(targetId: TEntity[PrimaryKey]): Promise<boolean> {
    const softDelete = Boolean(resolveSoftDeleteColumn(this.#binding.table));
    getBindingPorts(this.#binding).assertMutation(softDelete ? "deleted" : "force-deleted");
    if ((await runObservers(this as never, "deleting")) === false) {
      return false;
    }

    const deleted = softDelete
      ? await this.repository.deleteById(targetId)
      : await this.repository.forceDeleteById(targetId);

    if (deleted) {
      await runObservers(this as never, "deleted");
    }

    return deleted;
  }

  forceDelete(): Promise<boolean> {
    return this.#mutateSnapshot(undefined, (_attributes, id) => this.#forceDelete(id));
  }

  async #forceDelete(targetId: TEntity[PrimaryKey]): Promise<boolean> {
    getBindingPorts(this.#binding).assertMutation("force-deleted");
    return await this.repository.forceDeleteById(targetId);
  }

  restore(): Promise<this | null> {
    return this.#mutateSnapshot(undefined, (_attributes, id) => this.#restore(id));
  }

  async #restore(targetId: TEntity[PrimaryKey]): Promise<this | null> {
    getBindingPorts(this.#binding).assertMutation("restored");
    const record = await this.repository.restoreById(targetId);

    if (!record) {
      return null;
    }

    this.#acceptPersistedAttributes(record);
    return this;
  }

  #readTerminal<A, V>(
    prepare: () => A,
    work: (attributes: TEntity, input: A) => Promise<V>,
  ): Promise<V> {
    let attributes: TEntity;
    let input: A;
    try {
      getBindingPorts(this.#binding).assertEditable(this);
      attributes = snapshotAttributes(this.#attributes as LoadedAttributes) as TEntity;
      input = snapshotQueryPlan(prepare());
    } catch (error) {
      return this.#binding.run(() => {
        throw error;
      });
    }
    return this.#binding.run(() => work(attributes, input));
  }

  loadHasMany<
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
    return this.#readTerminal(
      () => ({
        as,
        relation,
        definition: relatedRepositoryDefinition(childRepository, this.#binding.session),
        options,
      }),
      async (attributes, plan) => {
        const repository = this.#binding.session.repository(plan.definition);
        const grouped = await repository.loadHasManyForParents(
          [attributes],
          plan.relation,
          plan.options,
        );
        const loaded = getByRelationKey(grouped, attributes[plan.relation.localKey]) ?? [];
        return Object.assign(this, { [plan.as]: loaded }) as this & Record<Alias, TChild[]>;
      },
    );
  }

  loadHasOne<
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
    return this.#readTerminal(
      () => ({
        as,
        relation,
        definition: relatedRepositoryDefinition(childRepository, this.#binding.session),
        options: { ...options, limit: 1 },
      }),
      async (attributes, plan) => {
        const repository = this.#binding.session.repository(plan.definition);
        const grouped = await repository.loadHasManyForParents(
          [attributes],
          plan.relation as unknown as HasManyRelation<TEntity, TChild, LocalKey, ForeignKey>,
          plan.options,
        );
        const loaded = getByRelationKey(grouped, attributes[plan.relation.localKey])?.[0];
        return Object.assign(this, { [plan.as]: loaded }) as this &
          Record<Alias, TChild | undefined>;
      },
    );
  }

  loadBelongsTo<
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
    return this.#readTerminal(
      () => ({
        as,
        relation,
        definition: relatedRepositoryDefinition(parentRepository, this.#binding.session),
        options,
      }),
      async (attributes, plan) => {
        const grouped = await this.#binding.repository.loadBelongsToForParents(
          [attributes],
          plan.relation,
          this.#binding.session.repository(plan.definition),
          plan.options,
        );
        const loaded = getByRelationKey(grouped, attributes[plan.relation.foreignKey]);
        return Object.assign(this, { [plan.as]: loaded }) as this &
          Record<Alias, TParent | undefined>;
      },
    );
  }

  loadBelongsToMany<
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
    return this.#readTerminal(
      () => ({
        as,
        relation,
        definition: relatedRepositoryDefinition(relatedRepository, this.#binding.session),
        options,
      }),
      async (attributes, plan) => {
        const connection = this.#binding.session;
        const dialect = this.#binding.dialect;
        const parentId = attributes[plan.relation.parentKey];
        const pivotRows = await connection.execute<Pivot>({
          text: `SELECT * FROM ${quoteIdentifier(dialect, plan.relation.pivotTable)} WHERE ${quoteIdentifier(dialect, String(plan.relation.foreignPivotKey))} = ${dialect.placeholder(1)}`,
          params: [parentId],
        });
        if (pivotRows.length === 0)
          return Object.assign(this, { [plan.as]: [] }) as this & Record<Alias, TRelated[]>;
        const relatedIds = [
          ...new Set(
            pivotRows.map(
              (row) => row[plan.relation.relatedPivotKey] as unknown as TRelated[RelatedKey],
            ),
          ),
        ];
        const relatedRows = await connection
          .repository(plan.definition)
          .findAll({ ...plan.options, where: { [plan.relation.relatedKey]: relatedIds } as never });
        const grouped = indexBelongsToManyRelation(
          [attributes],
          [...pivotRows],
          relatedRows,
          plan.relation,
        );
        const loaded = getByRelationKey(grouped, parentId) ?? [];
        return Object.assign(this, { [plan.as]: loaded }) as this & Record<Alias, TRelated[]>;
      },
    );
  }

  hasMany<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    M extends Model<TRelated, RelatedKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    foreignKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
  ): HasManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(this as never, related);
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

  hasOne<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    M extends Model<TRelated, RelatedKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    foreignKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
  ): HasOneRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(this as never, related);
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

  belongsTo<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    M extends Model<TRelated, RelatedKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    foreignKey?: keyof TEntity & string,
    ownerKey?: RelatedKey,
  ): BelongsToRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const relatedClass = resolveRelated(this as never, related);
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
    M extends Model<TRelated, RelatedKey>,
    ThroughM extends Model<TThrough, ThroughKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    through: RelatedRef<TThrough, ThroughKey, ThroughM>,
    firstKey?: string,
    secondKey?: keyof TRelated & string,
    localKey?: PrimaryKey,
    secondLocalKey?: ThroughKey,
  ): HasManyThroughRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(this as never, related);
    const throughClass = resolveRelated(this as never, through);
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
    M extends Model<TRelated, RelatedKey> = Model<TRelated, RelatedKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    pivotTable?: string,
    foreignPivotKey?: keyof Pivot & string,
    relatedPivotKey?: keyof Pivot & string,
  ): BelongsToManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey, Pivot> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(this as never, related);
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

  morphMany<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    M extends Model<TRelated, RelatedKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    morphName: string,
    typeKey?: keyof TRelated & string,
    idKey?: keyof TRelated & string,
    morphType?: string,
  ): MorphManyRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(this as never, related);
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

  morphOne<
    TRelated extends object,
    RelatedKey extends keyof TRelated & string,
    M extends Model<TRelated, RelatedKey>,
  >(
    related: RelatedRef<TRelated, RelatedKey, M>,
    morphName: string,
    typeKey?: keyof TRelated & string,
    idKey?: keyof TRelated & string,
    morphType?: string,
  ): MorphOneRelationQuery<TEntity, PrimaryKey, TRelated, RelatedKey> {
    const table = this.repository.getTable();
    const relatedClass = resolveRelated(this as never, related);
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
    relatedByType: Record<string, AnyModelDefinition | string | (() => AnyModelDefinition)>,
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
      Object.entries(relatedByType).map(([type, related]) => [
        type,
        getBindingPorts(this.#binding).model(
          (typeof related === "function" ? related() : related) as never,
        ),
      ]),
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

  load(...names: RelationNameInput[]): Promise<this> {
    let plan: Array<{ name: string; query: AnyRelationQuery }>;
    try {
      getBindingPorts(this.#binding).assertEditable(this);
      plan = flattenRelationNames(names).map((name) => {
        const root = name.split(".")[0] ?? name;
        const method = (this as unknown as Record<string, unknown>)[root];
        if (typeof method !== "function")
          throw new Error(`${this.constructor.name} has no relation method ${root}().`);
        return { name, query: (method.call(this) as AnyRelationQuery).snapshot() };
      });
    } catch (error) {
      return this.#binding.run(() => {
        throw error;
      });
    }
    return this.#binding.run(async () => {
      for (const { name, query } of plan) {
        if (name.includes(".")) await loadNested(this as never, name, query);
        else this.#loadedRelations[name] = await query.get();
      }
      return this;
    });
  }

  loaded<T = unknown>(name: string): T | undefined {
    return this.#loadedRelations[name] as T | undefined;
  }

  setLoaded(name: string, value: unknown): this {
    getBindingPorts(this.#binding).assertEditable(this);
    this.#loadedRelations[name] = value;
    return this;
  }

  set<K extends keyof TEntity>(key: K, value: TEntity[K]): this {
    getBindingPorts(this.#binding).assertEditable(this);
    this.#attributes[key] = value;
    return this;
  }

  fill(values: Partial<TEntity>): this {
    getBindingPorts(this.#binding).assertEditable(this);
    const facade = modelFacade(this);
    Object.assign(
      this.#attributes,
      filterMassAssignable(facade.$fillable, facade.$guarded, values as LoadedAttributes),
    );
    return this;
  }

  mergeAttributes(patch: Partial<TEntity>): this {
    getBindingPorts(this.#binding).assertEditable(this);
    Object.assign(this.attributes as LoadedAttributes, patch);
    return this;
  }
}

function relatedRepositoryDefinition<R extends object, K extends keyof R & string>(
  repository: BaseRepository<R, K>,
  session: ModelBinding<R, K, BaseRepository<R, K>>["session"],
): RepositoryDefinition<R, K, BaseRepository<R, K>> {
  const binding = getRepositoryBinding(repository);
  const ports = getBindingPorts(binding);
  ports.assertActive();
  if (binding.session !== session)
    throw new TypeError("Related repository requires the exact active session.");
  return ports.definition as unknown as RepositoryDefinition<R, K, BaseRepository<R, K>>;
}

class BoundModelFacade<R extends object, K extends keyof R & string, M extends Model<R, K>> {
  declare readonly prototype: M;
  readonly #binding: ModelBinding<R, K, BaseRepository<R, K>>;
  constructor(binding: ModelBinding<R, K, BaseRepository<R, K>>) {
    this.#binding = binding;
  }
  get binding(): ModelBinding<R, K, BaseRepository<R, K>> {
    return this.#binding;
  }
  get definition(): ModelDefinition<R, K, M> {
    return getBindingPorts(this.binding).modelDefinition as unknown as ModelDefinition<R, K, M>;
  }
  get name(): string {
    return this.definition.name;
  }
  get $fillable(): readonly string[] | undefined {
    return this.definition.attributes.fillable;
  }
  get $guarded(): readonly string[] | true | undefined {
    return this.definition.attributes.guarded;
  }
  get $casts(): ModelCasts {
    return this.definition.attributes.casts ?? {};
  }
  get $timestamps(): boolean {
    return this.definition.attributes.timestamps ?? true;
  }
  get $hidden(): readonly string[] | undefined {
    return this.definition.attributes.hidden;
  }
  get $visible(): readonly string[] | undefined {
    return this.definition.attributes.visible;
  }
  get $appends(): readonly string[] | undefined {
    return this.definition.attributes.appends;
  }
  repository(): BaseRepository<R, K> {
    getBindingPorts(this.binding).assertActive();
    return this.binding.repository;
  }
  scopeQuery<A extends object, B extends keyof A & string>(
    query: RepositoryQuery<A, B>,
  ): RepositoryQuery<A, B> {
    getBindingPorts(this.binding).assertActive();
    let scoped = query;
    for (const scope of getBindingPorts(this.binding).scopes)
      scoped = (scope(scoped) as RepositoryQuery<A, B>).protectWhere();
    return scoped;
  }
  hydrateAttributes<A extends object>(values: A): A {
    return applyCasts(values as LoadedAttributes, this.$casts, "hydrate") as A;
  }
  dehydrateAttributes(values: LoadedAttributes): Promise<LoadedAttributes> {
    let captured: LoadedAttributes;
    try {
      getBindingPorts(this.binding).assertActive();
      captured = snapshotAttributes(values);
    } catch (error) {
      return this.binding.run(() => {
        throw error;
      });
    }
    return this.binding.run(async () => {
      const cast = await applyCasts(captured, this.$casts, "dehydrate");
      const hook = getBindingPorts(this.binding).dehydrate;
      const written = hook ? await hook(snapshotAttributes(cast) as Readonly<Partial<R>>) : cast;
      return snapshotAttributes(written as LoadedAttributes);
    });
  }
  hydrate(values: R, exists = true): M {
    const ports = getBindingPorts(this.binding);
    ports.assertActive();
    const attributes = this.hydrateAttributes(
      snapshotAttributes(values as LoadedAttributes),
    ) as Partial<R>;
    if (!ports.construct) throw new TypeError("A model requires a prepared constructor.");
    return ports.construct(
      {
        attributes,
        original: snapshotAttributes(attributes as LoadedAttributes) as Partial<R>,
        exists,
        hidden: [],
        visible: undefined,
        appends: [],
      },
      undefined,
    ) as M;
  }
  newRecord(values: Partial<R>): M {
    return this.hydrate(values as R, false);
  }
  bind(source: NoInfer<M>): M {
    const sourceBinding = getModelBinding(source);
    const from = getBindingPorts(sourceBinding);
    const target = getBindingPorts(this.binding);
    if (
      from.app !== target.app ||
      from.pool !== target.pool ||
      sourceBinding.definition !== this.binding.definition ||
      !isDeepStrictEqual(from.tenant, target.tenant)
    )
      throw new TypeError("Model binding authority mismatch.");
    from.assertBindable(source);
    target.assertActive();
    if (!target.construct) throw new TypeError("A model requires a prepared constructor.");
    return target.construct(inspectModelState(source as never) as ModelState<R>, source) as M;
  }
  resolveRelated<A extends object, B extends keyof A & string, Related extends Model<A, B>>(
    reference: RelatedRef<A, B, Related>,
  ): RelatedModelClass<A, B> {
    const definition = typeof reference === "function" ? reference() : reference;
    return getBindingPorts(this.binding).model(definition) as unknown as RelatedModelClass<A, B>;
  }
  private terminal<V, A>(
    work: (facade: BoundModelFacade<R, K, M>, input: A, query: ModelQuery<M>) => Promise<V>,
    input: A,
  ): Promise<V> {
    let captured: A;
    let query: ModelQuery<M>;
    try {
      getBindingPorts(this.binding).assertActive();
      captured = snapshotQueryPlan(input);
      query = snapshotModelQuery(this.query());
    } catch (error) {
      return this.binding.run(() => {
        throw error;
      });
    }
    return this.binding.run(() => work(this, captured, query));
  }
  createOwned(values: Partial<R>, forced: Partial<R> = {}): Promise<M> {
    const ports = getBindingPorts(this.binding);
    ports.assertActive();
    ports.assertMutation("created");
    const attributes = snapshotAttributes(values as LoadedAttributes);
    const forcedValues = snapshotAttributes(forced as LoadedAttributes);
    const pending = this.newRecord({} as Partial<R>);
    return ports.mutate(pending, async () => {
      const table = this.binding.table;
      const assignable = {
        ...filterMassAssignable(this.$fillable, this.$guarded, attributes),
        ...forcedValues,
      };
      const payload = await this.dehydrateAttributes(
        applyTimestampsOnCreate(table.columns, assignable, this.$timestamps),
      );
      pending.mergeAttributes(this.hydrateAttributes(payload) as Partial<R>);
      const beforeObservers = snapshotAttributes(pending.toObject() as LoadedAttributes);
      if (
        (await runObservers(pending as never, "saving")) === false ||
        (await runObservers(pending as never, "creating")) === false
      )
        throw new Error(`${this.name}.create() was cancelled by an observer.`);
      const edits = changedAttributes(pending.toObject() as LoadedAttributes, beforeObservers);
      const forcedKeys = new Set(Object.keys(forcedValues));
      for (const key of forcedKeys) delete edits[key];
      let finalPayload = payload;
      if (Object.keys(edits).length) {
        const changed = await this.dehydrateAttributes(edits);
        finalPayload = {
          ...payload,
          ...Object.fromEntries(Object.entries(changed).filter(([key]) => !forcedKeys.has(key))),
        };
      }
      const record = await this.binding.repository.create(finalPayload as MutationValues<R>);
      acceptModelRecord(pending as never, record);
      await runObservers(pending as never, "created");
      await runObservers(pending as never, "saved");
      return pending;
    });
  }
  query<TModel extends object>(this: { prototype: TModel }): ModelQuery<TModel>;
  query(this: object): ModelQuery {
    const repository = modelStatics(this).repository();
    const scopeQuery = BoundModelFacade.prototype.scopeQuery<Record<string, unknown>, "id">;
    return new ModelQuery(this, scopeQuery.call(this, repository.query()));
  }

  newFromRecord<TModel extends object>(
    this: { prototype: TModel },
    record: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
    exists: false,
  ): TModel;
  newFromRecord<TModel extends object>(
    this: { prototype: TModel },
    record: NoInfer<ModelAttributes<TModel>>,
    exists?: boolean,
  ): TModel;
  newFromRecord(this: object, record: object, exists = true): Model<Record<string, unknown>, "id"> {
    return modelStatics(this).hydrate(record as Record<string, unknown>, exists) as AnyModel;
  }

  /** Trusted SQL/driver/partial-record hydration. Callers own shape and completeness. */
  newFromTrustedRecord<TModel extends object>(
    this: { prototype: TModel },
    record: object,
    exists?: boolean,
  ): TModel;
  newFromTrustedRecord(this: object, record: object, exists = true): AnyModel {
    return modelStatics(this).hydrate(record as Record<string, unknown>, exists);
  }

  create<TModel extends object>(
    this: { prototype: TModel },
    attributes: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
    forced?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
  create(
    this: object,
    attributes: Record<string, unknown>,
    forced: Record<string, unknown> = {},
  ): Promise<AnyModel> {
    const facade = modelStatics(this);
    return facade.createOwned(attributes, forced) as Promise<AnyModel>;
  }

  with<TModel extends object>(
    this: { prototype: TModel },
    ...relations: RelationNameInput[]
  ): ModelQuery<TModel>;
  with(this: object, ...relations: RelationNameInput[]): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .with(...relations);
  }

  withTrashed<TModel extends object>(this: { prototype: TModel }): ModelQuery<TModel>;
  withTrashed(this: object): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .withTrashed();
  }

  onlyTrashed<TModel extends object>(this: { prototype: TModel }): ModelQuery<TModel>;
  onlyTrashed(this: object): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .onlyTrashed();
  }

  chunk<TModel extends object>(
    this: { prototype: TModel },
    count: number,
    // biome-ignore lint/suspicious/noConfusingVoidType: Existing chunk callbacks may return no value.
    callback: (models: TModel[]) => Promise<boolean | void>,
  ): Promise<void>;
  chunk(
    this: object,
    count: number,
    // biome-ignore lint/suspicious/noConfusingVoidType: Existing chunk callbacks may return no value.
    callback: (models: Array<Model<Record<string, unknown>, "id">>) => Promise<boolean | void>,
  ): Promise<void> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const statics = modelStatics(facade);
        await capturedQuery.query.chunk(input.count, async (rows) => {
          return await input.callback(
            rows.map(
              (row) => statics.newFromRecord(row, true) as Model<Record<string, unknown>, "id">,
            ),
          );
        });
      },
      { count, callback },
    );
  }

  keysetPaginate<TModel extends object>(
    this: { prototype: TModel },
    options: KeysetOptions<ModelAttributes<TModel>>,
  ) {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery<TModel>)
      .call(this)
      .keysetPaginate(options);
  }

  cursorPaginate<TModel extends object>(
    this: { prototype: TModel },
    options: { perPage: number; cursor?: unknown },
  ): Promise<{
    data: TModel[];
    meta: { per_page: number; next_cursor: unknown; prev_cursor: unknown; has_more: boolean };
  }>;
  cursorPaginate(
    this: object,
    options: { perPage: number; cursor?: unknown },
  ): Promise<{
    data: Array<Model<Record<string, unknown>, "id">>;
    meta: { per_page: number; next_cursor: unknown; prev_cursor: unknown; has_more: boolean };
  }> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const statics = modelStatics(facade);
        const page = await capturedQuery.query.cursorPaginate({
          perPage: input.options.perPage,
          cursor: input.options.cursor as never,
        });
        return {
          data: page.data.map(
            (row) => statics.newFromRecord(row, true) as Model<Record<string, unknown>, "id">,
          ),
          meta: page.meta,
        };
      },
      { options },
    );
  }

  whereHas<TModel extends object>(
    this: { prototype: TModel },
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery<TModel>;
  whereHas(this: object, name: string, constrain?: (query: AnyRelationQuery) => void): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .whereHas(name, constrain);
  }

  has<TModel extends object>(this: { prototype: TModel }, name: string): ModelQuery<TModel>;
  has(this: object, name: string): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery).call(this).has(name);
  }

  doesntHave<TModel extends object>(this: { prototype: TModel }, name: string): ModelQuery<TModel>;
  doesntHave(this: object, name: string): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .doesntHave(name);
  }

  whereDoesntHave<TModel extends object>(
    this: { prototype: TModel },
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery<TModel>;
  whereDoesntHave(
    this: object,
    name: string,
    constrain?: (query: AnyRelationQuery) => void,
  ): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .whereDoesntHave(name, constrain);
  }

  find<TModel extends object>(
    this: { prototype: TModel },
    id: NoInfer<ModelIdentifier<TModel>>,
  ): Promise<TModel | null>;
  find(this: object, id: unknown): Promise<Model<Record<string, unknown>, "id"> | null> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const primaryKey = modelStatics(facade).repository().getTable().primaryKey;
        return capturedQuery.where({ [primaryKey]: input.id } as QueryWhere<object>).first();
      },
      { id },
    );
  }

  findOrFail<TModel extends object>(
    this: { prototype: TModel },
    id: NoInfer<ModelIdentifier<TModel>>,
    errorFactory?: (id: unknown) => Error,
  ): Promise<TModel>;
  findOrFail(
    this: object,
    id: unknown,
    errorFactory?: (id: unknown) => Error,
  ): Promise<Model<Record<string, unknown>, "id">> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const model = await capturedQuery.find(input.id);

        if (model) {
          return model;
        }

        throw (
          input.errorFactory?.(input.id) ??
          new NotFoundError(`${(facade as { name: string }).name} ${String(input.id)} not found.`)
        );
      },
      { id, errorFactory },
    );
  }

  all<TModel extends object>(
    this: { prototype: TModel },
    options?: Omit<QueryOptions<ModelAttributes<TModel>>, "where" | "select">,
  ): Promise<TModel[]>;
  all(
    this: object,
    options: Omit<QueryOptions<object>, "where"> = {},
  ): Promise<Array<Model<Record<string, unknown>, "id">>> {
    return modelStatics(this).terminal(
      async (_facade, input, capturedQuery) => {
        let query = capturedQuery;

        if (input.options.orderBy) {
          query = query.orderBy(input.options.orderBy);
        }

        if (input.options.limit !== undefined) {
          query = query.limit(input.options.limit);
        }

        return query.get();
      },
      { options },
    );
  }

  where<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
  ): ModelQuery<TModel>;
  where(this: object, where: QueryWhere<object>): ModelQuery {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .where(where);
  }

  count(this: object): Promise<number> {
    return modelStatics(this).terminal(async (_facade, _input, capturedQuery) => {
      return capturedQuery.count();
    }, {});
  }

  pluck(this: object, column: string): Promise<unknown[]>;
  pluck(this: object, column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  pluck(this: object, column: string, keyBy?: string): Promise<unknown[] | Map<unknown, unknown>> {
    const query = (BoundModelFacade.prototype.query as (this: object) => ModelQuery).call(this);
    return keyBy === undefined ? query.pluck(column) : query.pluck(column, keyBy);
  }

  value(this: object, column: string): Promise<unknown> {
    return (BoundModelFacade.prototype.query as (this: object) => ModelQuery)
      .call(this)
      .value(column);
  }

  firstWhere<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    options?: Omit<QueryOptions<ModelAttributes<TModel>>, "where" | "select">,
  ): Promise<TModel | null>;
  firstWhere(
    this: object,
    where: QueryWhere<object>,
    options: Omit<QueryOptions<object>, "where"> = {},
  ): Promise<Model<Record<string, unknown>, "id"> | null> {
    return modelStatics(this).terminal(
      async (_facade, input, capturedQuery) => {
        let query = capturedQuery.where(input.where);

        if (input.options.orderBy) {
          query = query.orderBy(input.options.orderBy);
        }

        return query.first();
      },
      { where, options },
    );
  }

  firstOrNew<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    values?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
  firstOrNew(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const existing = await snapshotModelQuery(capturedQuery).whereDynamic(input.where).first();

        if (existing) {
          return existing;
        }

        return modelStatics(facade).newFromRecord({ ...input.where, ...input.values }, false);
      },
      { where, values },
    );
  }

  firstOrCreate<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    values?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
  firstOrCreate(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const findExisting = () =>
          snapshotModelQuery(capturedQuery).whereDynamic(input.where).first();

        const existing = await findExisting();

        if (existing) {
          return existing;
        }

        try {
          return await (
            BoundModelFacade.prototype.create as (
              this: object,
              attributes: Record<string, unknown>,
            ) => Promise<Model<Record<string, unknown>, "id">>
          ).call(facade, { ...input.where, ...input.values });
        } catch (error) {
          if (!isUniqueConstraintError(error)) {
            throw error;
          }

          const raced = await findExisting();

          if (!raced) {
            throw error;
          }

          return raced;
        }
      },
      { where, values },
    );
  }

  updateOrCreate<TModel extends object>(
    this: { prototype: TModel },
    where: NoInfer<ModelWhere<ModelAttributes<TModel>>>,
    values?: NoInfer<ModelWriteValues<ModelAttributes<TModel>>>,
  ): Promise<TModel>;
  updateOrCreate(
    this: object,
    where: QueryWhere<object>,
    values: Record<string, unknown> = {},
  ): Promise<Model<Record<string, unknown>, "id">> {
    return modelStatics(this).terminal(
      async (facade, input, capturedQuery) => {
        const existing = await snapshotModelQuery(capturedQuery).whereDynamic(input.where).first();

        if (existing) {
          return existing.update(input.values);
        }

        return (
          BoundModelFacade.prototype.create as (
            this: object,
            attributes: Record<string, unknown>,
          ) => Promise<Model<Record<string, unknown>, "id">>
        ).call(facade, { ...input.where, ...input.values });
      },
      { where, values },
    );
  }
}

function createBoundModel<R extends object, K extends keyof R & string, M extends Model<R, K>>(
  binding: ModelBinding<R, K, BaseRepository<R, K>>,
): BoundModelFacade<R, K, M> {
  return new BoundModelFacade(binding);
}

export { defineModel } from "@getstrata/core/database/definitions";
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
export type { CastType, ModelAttributes, ModelProjection, RelatedRef };
export {
  applyCasts,
  BoundModelFacade,
  createBoundModel,
  dehydrateValue,
  filterMassAssignable,
  getModelBinding,
  hydrateValue,
  Model,
  ModelQuery,
  modelFacade,
  runObservers,
  saveRelatedModel,
};
