import {
  type AnyServiceToken,
  assertServiceToken,
  type ServiceToken,
} from "@getstrata/core/contracts/token";
import type { ExecutionContext } from "../contracts/application";
import type { ExecutionPersistence } from "../contracts/persistence";
import type { DependencyValues, NonPromisePayload } from "../contracts/services";
import type { CursorPaginatedResult, KeysetCursor, KeysetOptions } from "../pagination/index";
import type { BaseRepository } from "./baseRepository";
import type { DatabaseCapabilities } from "./driverPorts";
import type { Model } from "./model";
import type { ModelCasts } from "./modelAttributes";
import type { ModelQuery, RelationNameInput } from "./modelQuery";
import type { AnyRelationQuery } from "./relationQuery";
import type { RepositoryQuery } from "./repositoryQuery";
import type { DatabaseSession } from "./session";
import type { SqlDialect } from "./sqlDialects";
import type { TableDefinition } from "./table";
import type { TransactionSession } from "./transactionSession";
import type { ModelWhere, ModelWriteValues, QueryOptions } from "./types";

const definitionBrand: unique symbol = Symbol("database.definition");
declare const repositoryType: unique symbol;
declare const modelType: unique symbol;
declare const modelIdentityType: unique symbol;
type Session = DatabaseSession | TransactionSession;
interface RepositoryBinding<R extends object, K extends keyof R & string> {
  readonly session: Session;
  readonly table: TableDefinition<R, K>;
  readonly dialect: SqlDialect;
  readonly capabilities: DatabaseCapabilities;
  readonly run: <V>(work: () => V | Promise<V>) => Promise<V>;
}
interface ModelBinding<R extends object, K extends keyof R & string, T extends BaseRepository<R, K>>
  extends RepositoryBinding<R, K> {
  readonly definition: ModelIdentity<R, K>;
  readonly repository: T;
}
interface ModelIdentity<R extends object, K extends keyof R & string> {
  readonly [modelIdentityType]: (value: [R, K]) => [R, K];
  readonly kind: "model";
  readonly name: string;
  readonly [definitionBrand]: object;
}
interface ModelState<R extends object> {
  readonly attributes: Partial<R>;
  readonly original: Partial<R>;
  readonly exists: boolean;
  readonly hidden: readonly string[];
  readonly visible: readonly string[] | undefined;
  readonly appends: readonly string[];
}
interface ModelAttributeOptions<R extends object> {
  readonly fillable?: readonly (keyof R & string)[];
  readonly guarded?: readonly (keyof R & string)[] | true;
  readonly casts?: ModelCasts;
  readonly timestamps?: boolean;
  readonly hidden?: readonly string[];
  readonly visible?: readonly string[];
  readonly appends?: readonly string[];
  readonly dehydrate?: (
    values: Readonly<Partial<R>>,
    ...dependencies: never[]
  ) => Partial<R> | Promise<Partial<R>>;
}
type ModelObserver<M> = Partial<
  Record<
    | "retrieved"
    | "creating"
    | "created"
    | "updating"
    | "updated"
    | "saving"
    | "saved"
    | "deleting"
    | "deleted",
    (model: M) => unknown
  >
>;
type RepositoryAction = "created" | "updated" | "deleted" | "restored" | "force-deleted";
interface RepositoryHooks<R extends object, K extends keyof R & string> {
  readonly transformQuery?: (
    plan: QueryOptions<R>,
    binding: RepositoryBinding<R, K>,
  ) => QueryOptions<R>;
  readonly transformWrite?: (
    action: RepositoryAction,
    values: Readonly<Partial<R>>,
    binding: RepositoryBinding<R, K>,
  ) => Partial<R> | Promise<Partial<R>>;
  readonly hydrateRow?: (row: Readonly<R>, binding: RepositoryBinding<R, K>) => R;
}
type RepositoryPublication<R extends object, K extends keyof R & string> = Readonly<{
  session: TransactionSession;
  definition: RepositoryDefinition<R, K, BaseRepository<R, K>>;
  action: RepositoryAction;
  row: Readonly<R>;
}>;
type TransactionalRepositoryListener<R extends object, K extends keyof R & string> = (
  publication: RepositoryPublication<R, K>,
) => void | Promise<void>;
type AfterCommitRepositoryContext = Readonly<
  ExecutionPersistence & { execution: ExecutionContext }
>;
type AfterCommitRepositoryListener<R extends object> = (
  row: Readonly<R>,
  context: AfterCommitRepositoryContext,
) => void | Promise<void>;
interface RepositoryEffect {
  readonly action: RepositoryAction;
  readonly transactional?: AnyServiceToken;
  readonly afterCommit?: AnyServiceToken;
}
const effectsBrand: unique symbol = Symbol("database.repository.effects");
interface RepositoryEffectsDeclaration {
  readonly definition: AnyRepositoryDefinition;
  readonly effects: readonly RepositoryEffect[];
  readonly [effectsBrand]: object;
}
type TypedRepositoryEffect<R extends object, K extends keyof R & string> = Readonly<{
  action: RepositoryAction;
  transactional?: ServiceToken<TransactionalRepositoryListener<R, K>>;
  afterCommit?: ServiceToken<AfterCommitRepositoryListener<R>>;
}>;
interface AnyRepositoryDefinition {
  readonly kind: "repository";
  readonly name: string;
  readonly [definitionBrand]: object;
  readonly table: Readonly<{
    name: string;
    primaryKey: string;
    columns: readonly string[];
    defaultOrderBy?: unknown;
    softDeletes?: unknown;
  }>;
  readonly dependencies: readonly AnyServiceToken[];
  readonly create: (...args: never[]) => unknown;
  readonly hooks?: unknown;
  readonly effects: readonly RepositoryEffect[];
}
interface AnyModelDefinition
  extends Omit<ModelIdentity<Record<string, unknown>, string>, typeof modelIdentityType> {
  readonly aliases: readonly string[];
  readonly repository: AnyRepositoryDefinition;
  readonly dependencies: readonly AnyServiceToken[];
  readonly attributes: Readonly<{
    fillable?: readonly string[];
    guarded?: readonly string[] | true;
    casts?: ModelCasts;
    timestamps?: boolean;
    hidden?: readonly string[];
    visible?: readonly string[];
    appends?: readonly string[];
    dehydrate?: (...arguments_: never[]) => unknown;
  }>;
  readonly observers: readonly AnyServiceToken[];
  readonly scopes: readonly ((...args: never[]) => unknown)[];
  readonly construct: (...args: never[]) => unknown;
}
type RepositoryDefinition<
  R extends object,
  K extends keyof R & string,
  T extends BaseRepository<R, K>,
> = Omit<AnyRepositoryDefinition, "table" | "create" | "hooks"> & {
  readonly table: TableDefinition<R, K>;
  readonly create: (binding: RepositoryBinding<R, K>, ...dependencies: never[]) => T;
  readonly hooks?: RepositoryHooks<R, K>;
  readonly [repositoryType]: (value: [R, K, T]) => [R, K, T];
};
type ModelDefinition<R extends object, K extends keyof R & string, M extends Model<R, K>> = Omit<
  AnyModelDefinition,
  "repository" | "attributes" | "construct"
> & {
  readonly repository: AnyRepositoryDefinition;
  readonly attributes: ModelAttributeOptions<R>;
  readonly construct: (
    state: ModelState<R>,
    binding: ModelBinding<R, K, BaseRepository<R, K>>,
    source: M | undefined,
    ...dependencies: never[]
  ) => M;
  readonly [modelType]: (value: [R, K, M]) => [R, K, M];
  readonly [modelIdentityType]: (value: [R, K]) => [R, K];
};
interface BoundModel<R extends object, K extends keyof R & string, M extends Model<R, K>> {
  readonly definition: ModelDefinition<R, K, M>;
  readonly name: string;
  repository(): BaseRepository<R, K>;
  query(): ModelQuery<M>;
  newRecord(values: Partial<R>): M;
  hydrate(values: R, exists?: boolean): M;
  bind(source: NoInfer<M>): M;

  newFromRecord(record: ModelWriteValues<R>, exists: false): M;
  newFromRecord(record: R, exists?: boolean): M;
  /** Trusted SQL/driver/partial-record hydration; the caller owns completeness. */
  newFromTrustedRecord(record: object, exists?: boolean): M;

  create(values: ModelWriteValues<R>, forced?: ModelWriteValues<R>): Promise<M>;
  find(id: R[K]): Promise<M | null>;
  findOrFail(id: R[K], errorFactory?: (id: unknown) => Error): Promise<M>;
  all(options?: Omit<QueryOptions<R>, "where" | "select">): Promise<M[]>;
  where(where: ModelWhere<R>): ModelQuery<M>;
  firstWhere(
    where: ModelWhere<R>,
    options?: Omit<QueryOptions<R>, "where" | "select">,
  ): Promise<M | null>;
  firstOrNew(where: ModelWhere<R>, values?: ModelWriteValues<R>): Promise<M>;
  firstOrCreate(where: ModelWhere<R>, values?: ModelWriteValues<R>): Promise<M>;
  updateOrCreate(where: ModelWhere<R>, values?: ModelWriteValues<R>): Promise<M>;

  with(...relations: RelationNameInput[]): ModelQuery<M>;
  withTrashed(): ModelQuery<M>;
  onlyTrashed(): ModelQuery<M>;
  whereHas(name: string, constrain?: (query: AnyRelationQuery) => void): ModelQuery<M>;
  has(name: string): ModelQuery<M>;
  doesntHave(name: string): ModelQuery<M>;
  whereDoesntHave(name: string, constrain?: (query: AnyRelationQuery) => void): ModelQuery<M>;

  count(): Promise<number>;
  pluck(column: string): Promise<unknown[]>;
  pluck(column: string, keyBy: string): Promise<Map<unknown, unknown>>;
  value(column: string): Promise<unknown>;
  // The established callback contract accepts Promise<void> and optional false to stop.
  // biome-ignore lint/suspicious/noConfusingVoidType: Existing asynchronous callback contract.
  chunk(count: number, callback: (models: M[]) => Promise<boolean | void>): Promise<void>;
  keysetPaginate(options: KeysetOptions<R>): Promise<CursorPaginatedResult<M, KeysetCursor>>;
  cursorPaginate(options: { perPage: number; cursor?: unknown }): Promise<CursorPaginatedResult<M>>;
}

function fields(input: object): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Invalid database definition.");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Metadata must be a plain record.");
  const copied: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") throw new TypeError("Invalid database definition field.");
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !("value" in d)) throw new TypeError("Database metadata accessors are unsupported.");
    copied[key] = d.value;
  }
  return copied;
}
function array<T>(value: readonly T[]): T[] {
  if (!Array.isArray(value)) throw new TypeError("Metadata requires an array.");
  const result: T[] = [];
  for (let index = 0; index < value.length; index++) {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (!d || !("value" in d))
      throw new TypeError("Metadata array accessors and holes are unsupported.");
    result.push(d.value);
  }
  return result;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError("Definition name must be nonempty.");
}
function brand<T extends object>(value: T): Readonly<T> {
  Object.defineProperty(value, definitionBrand, { value });
  return Object.freeze(value);
}
function tokens(values: readonly AnyServiceToken[]): readonly AnyServiceToken[] {
  if (!Array.isArray(values)) throw new TypeError("Dependencies must be a tuple.");
  const copied = array(values);
  for (const token of copied) assertServiceToken(token);
  return Object.freeze(copied);
}
function snapshotTable<R extends object, K extends keyof R & string>(
  table: TableDefinition<R, K>,
): TableDefinition<R, K> {
  const v = fields(table);
  text(v.name);
  text(v.primaryKey);
  if (
    !Array.isArray(v.columns) ||
    !array(v.columns).every((c) => typeof c === "string") ||
    !array(v.columns).includes(v.primaryKey)
  )
    throw new TypeError("Invalid table columns.");
  return Object.freeze({
    ...v,
    columns: Object.freeze(array(v.columns)),
    ...(v.defaultOrderBy === undefined
      ? {}
      : {
          defaultOrderBy: Object.freeze(
            Array.isArray(v.defaultOrderBy)
              ? array(v.defaultOrderBy).map((o) => Object.freeze(fields(o)))
              : fields(v.defaultOrderBy as object),
          ),
        }),
    ...(typeof v.softDeletes === "object" && v.softDeletes !== null
      ? { softDeletes: Object.freeze(fields(v.softDeletes)) }
      : {}),
  }) as unknown as TableDefinition<R, K>;
}
function defineRepository<
  R extends object,
  K extends keyof R & string,
  T extends BaseRepository<R, K>,
  const D extends readonly AnyServiceToken[],
>(s: {
  name: string;
  table: TableDefinition<R, K>;
  dependencies: D;
  hooks?: RepositoryHooks<R, K>;
  effects?: readonly Readonly<{
    action: RepositoryAction;
    transactional?: ServiceToken<TransactionalRepositoryListener<R, K>>;
    afterCommit?: ServiceToken<AfterCommitRepositoryListener<R>>;
  }>[];
  create: (
    binding: RepositoryBinding<R, K>,
    ...dependencies: DependencyValues<D>
  ) => T & NonPromisePayload<T>;
}): RepositoryDefinition<R, K, T> {
  fields(s);
  text(s.name);
  if (typeof s.create !== "function") throw new TypeError("Repository requires a constructor.");
  const hooks = s.hooks === undefined ? undefined : fields(s.hooks);
  if (
    hooks &&
    Object.entries(hooks).some(
      ([key, value]) =>
        !["transformQuery", "transformWrite", "hydrateRow"].includes(key) ||
        typeof value !== "function",
    )
  )
    throw new TypeError("Invalid repository hook.");
  return brand({
    kind: "repository",
    name: s.name,
    table: snapshotTable(s.table),
    dependencies: tokens(s.dependencies),
    create: s.create,
    effects: snapshotEffects(s.effects ?? []),
    ...(hooks ? { hooks: Object.freeze(hooks) } : {}),
  }) as unknown as RepositoryDefinition<R, K, T>;
}
function defineModel<
  R extends object,
  K extends keyof R & string,
  M extends Model<R, K>,
  T extends BaseRepository<R, K>,
  const D extends readonly AnyServiceToken[],
>(s: {
  name: string;
  aliases?: readonly string[];
  repository: RepositoryDefinition<R, K, T>;
  dependencies: D;
  attributes: Omit<ModelAttributeOptions<R>, "dehydrate"> & {
    readonly dehydrate?: (
      values: Readonly<Partial<R>>,
      ...dependencies: DependencyValues<D>
    ) => Partial<R> | Promise<Partial<R>>;
  };
  observers?: readonly ServiceToken<ModelObserver<M>>[];
  scopes?: readonly ((
    query: RepositoryQuery<R, K>,
    ...dependencies: DependencyValues<D>
  ) => RepositoryQuery<R, K>)[];
  construct: (
    state: ModelState<R>,
    binding: ModelBinding<R, K, T>,
    source: M | undefined,
    ...dependencies: DependencyValues<D>
  ) => M & NonPromisePayload<M>;
}): ModelDefinition<R, K, M> {
  fields(s);
  text(s.name);
  assertDefinition(s.repository, "repository");
  if (typeof s.construct !== "function") throw new TypeError("Model requires a constructor.");
  const attrs = fields(s.attributes);
  if (
    Object.keys(attrs).some(
      (key) =>
        ![
          "fillable",
          "guarded",
          "casts",
          "timestamps",
          "hidden",
          "visible",
          "appends",
          "dehydrate",
        ].includes(key),
    )
  )
    throw new TypeError("Unknown model metadata.");
  for (const key of ["fillable", "guarded", "hidden", "visible", "appends"])
    if (
      attrs[key] !== undefined &&
      !(key === "guarded" && attrs[key] === true) &&
      !Array.isArray(attrs[key])
    )
      throw new TypeError("Invalid model metadata array.");
  if (attrs.dehydrate !== undefined && typeof attrs.dehydrate !== "function")
    throw new TypeError("Invalid model dehydration hook.");
  if (attrs.timestamps !== undefined && typeof attrs.timestamps !== "boolean")
    throw new TypeError("Invalid timestamps metadata.");
  for (const key of ["fillable", "guarded", "hidden", "visible", "appends"])
    if (Array.isArray(attrs[key])) {
      const values = array(attrs[key]);
      for (const value of values) text(value);
      attrs[key] = Object.freeze(values);
    }
  if (attrs.casts) {
    const casts = fields(attrs.casts as object);
    if (
      Object.values(casts).some(
        (value) =>
          typeof value !== "string" ||
          !["date", "datetime", "json", "bool", "boolean", "integer", "int", "hashed"].includes(
            value,
          ),
      )
    )
      throw new TypeError("Invalid model cast.");
    attrs.casts = Object.freeze(casts);
  }
  const aliases = array(s.aliases ?? []);
  for (const alias of aliases) text(alias);
  return brand({
    kind: "model",
    name: s.name,
    aliases: Object.freeze(aliases),
    repository: s.repository,
    dependencies: tokens(s.dependencies),
    attributes: Object.freeze(attrs),
    observers: tokens(s.observers ?? []),
    scopes: Object.freeze(
      array(s.scopes ?? []).map((scope) => {
        if (typeof scope !== "function") throw new TypeError("Scope must be a function.");
        return scope;
      }),
    ),
    construct: s.construct,
  }) as unknown as ModelDefinition<R, K, M>;
}
function assertDefinition(
  value: unknown,
  kind: "repository",
): asserts value is AnyRepositoryDefinition;
function assertDefinition(value: unknown, kind: "model"): asserts value is AnyModelDefinition;
function assertDefinition(
  value: unknown,
  kind: "repository" | "model",
): asserts value is AnyRepositoryDefinition | AnyModelDefinition {
  if (
    !value ||
    typeof value !== "object" ||
    !Object.isFrozen(value) ||
    Object.getOwnPropertyDescriptor(value, definitionBrand)?.value !== value ||
    Object.getOwnPropertyDescriptor(value, "kind")?.value !== kind
  )
    throw new TypeError("Expected original database definition.");
}

export type {
  AfterCommitRepositoryContext,
  AfterCommitRepositoryListener,
  AnyModelDefinition,
  AnyRepositoryDefinition,
  BoundModel,
  ModelAttributeOptions,
  ModelBinding,
  ModelDefinition,
  ModelIdentity,
  ModelObserver,
  ModelState,
  RepositoryAction,
  RepositoryBinding,
  RepositoryDefinition,
  RepositoryEffect,
  RepositoryHooks,
  RepositoryPublication,
  TransactionalRepositoryListener,
};
export { assertDefinition, defineModel, defineRepository };

function snapshotEffects(effects: readonly RepositoryEffect[]): readonly RepositoryEffect[] {
  return Object.freeze(
    array(effects).map((effect) => {
      fields(effect);
      if (!["created", "updated", "deleted", "restored", "force-deleted"].includes(effect.action))
        throw new TypeError("Invalid repository effect action.");
      if (effect.transactional) assertServiceToken(effect.transactional);
      if (effect.afterCommit) assertServiceToken(effect.afterCommit);
      return Object.freeze({ ...effect });
    }),
  );
}
function repositoryEffects<
  R extends object,
  K extends keyof R & string,
  T extends BaseRepository<R, K>,
>(
  definition: RepositoryDefinition<R, K, T>,
  effects: readonly TypedRepositoryEffect<R, K>[],
): RepositoryEffectsDeclaration {
  assertDefinition(definition, "repository");
  const declaration = { definition, effects: snapshotEffects(effects) };
  Object.defineProperty(declaration, effectsBrand, { value: declaration });
  return Object.freeze(declaration) as unknown as RepositoryEffectsDeclaration;
}
function assertRepositoryEffectsDeclaration(
  value: unknown,
): asserts value is RepositoryEffectsDeclaration {
  if (
    !value ||
    typeof value !== "object" ||
    !Object.isFrozen(value) ||
    Object.getOwnPropertyDescriptor(value, effectsBrand)?.value !== value
  )
    throw new TypeError("Expected original repository effects declaration.");
}

export type { RepositoryEffectsDeclaration, TypedRepositoryEffect };
export { assertRepositoryEffectsDeclaration, repositoryEffects };
