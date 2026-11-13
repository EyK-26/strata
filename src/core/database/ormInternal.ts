import { AsyncLocalStorage } from "node:async_hooks";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { PersistenceError } from "@getstrata/core/database/errors";
/** Source-private ORM capability transport. Never re-export from a package. */
import type { OwnedBoundary, OwnedExecution } from "../contracts/executionOwnership";
import type { BaseRepository } from "./baseRepository";
import type {
  AnyModelDefinition,
  AnyRepositoryDefinition,
  BoundModel,
  ModelBinding,
  ModelDefinition,
  ModelObserver,
  ModelState,
  RepositoryAction,
  RepositoryBinding,
  RepositoryDefinition,
  RepositoryHooks,
} from "./definitions";
import type { DatabaseConnectionOptions, DatabaseDriver } from "./driverPorts";
import type { Model } from "./model";
import type { DatabaseSession } from "./session";
import type { TransactionSession } from "./transactionSession";

type Session = DatabaseSession | TransactionSession;
interface BindingPorts<R extends object, K extends keyof R & string> {
  readonly app: object;
  readonly pool: object;
  readonly branch: object;
  readonly tenant: unknown;
  readonly definition: AnyRepositoryDefinition;
  readonly hooks: RepositoryHooks<R, K> | undefined;
  readonly assertActive: () => void;
  readonly repository: <
    A extends object,
    B extends keyof A & string,
    T extends BaseRepository<A, B>,
  >(
    definition: RepositoryDefinition<A, B, T>,
  ) => T;
  readonly model: <A extends object, B extends keyof A & string, M extends Model<A, B>>(
    definition: ModelDefinition<A, B, M> | string,
  ) => BoundModel<A, B, M>;
  readonly reselect: <T extends BaseRepository<R, K>>(session: Session) => T;
  readonly assertMutation: (action: RepositoryAction) => void;
  readonly mutation: <V>(
    action: RepositoryAction,
    work: (repository: BaseRepository<R, K>) => V | Promise<V>,
  ) => Promise<V>;
  readonly publish: (action: RepositoryAction, row: Readonly<R>) => Promise<void>;
  readonly registerRestore: (restore: () => undefined) => void;
  readonly mutate: <V>(entity: object, work: () => V | Promise<V>) => Promise<V>;
  readonly assertEditable: (entity: object) => void;
  readonly assertBindable: (entity: object) => void;
  readonly dehydrate:
    | ((values: Readonly<Partial<R>>) => Partial<R> | Promise<Partial<R>>)
    | undefined;
  readonly observers: readonly ModelObserver<unknown>[];
  readonly scopes: readonly ((query: unknown) => unknown)[];
  readonly construct:
    | ((state: ModelState<R>, source: Model<R, K> | undefined) => Model<R, K>)
    | undefined;
  readonly modelDefinition: AnyModelDefinition | undefined;
}
const portsKey: unique symbol = Symbol("database.binding.ports");
function attachBindingPorts<
  R extends object,
  K extends keyof R & string,
  B extends RepositoryBinding<R, K>,
>(binding: B, ports: BindingPorts<R, K>): B {
  Object.defineProperty(binding, portsKey, { value: ports });
  return Object.freeze(binding);
}
function getBindingPorts<R extends object, K extends keyof R & string>(
  binding: RepositoryBinding<R, K>,
): BindingPorts<R, K> {
  const ports = Object.getOwnPropertyDescriptor(binding, portsKey)?.value as
    | BindingPorts<R, K>
    | undefined;
  if (!ports) throw new TypeError("Unattached database binding.");
  return ports;
}
/** Per-attached-binding state, not a mutable per-class or app-global association. */
function createMutationPorts(ownership: OwnedExecution, assertActive: () => void) {
  const active = new WeakMap<object, OwnedBoundary | undefined>();
  return {
    assertBindable(entity: object): void {
      if (active.has(entity)) throw new TypeError("Cannot bind a mutating model.");
    },
    assertEditable(entity: object): void {
      assertActive();
      if (active.has(entity)) {
        const boundary = active.get(entity);
        if (!boundary) throw new TypeError("Model mutation is pending.");
        boundary.assertWithin();
      }
    },
    mutate<V>(
      entity: object,
      run: <T>(work: () => T | Promise<T>) => Promise<T>,
      work: () => V | Promise<V>,
    ): Promise<V> {
      assertActive();
      if (active.has(entity)) throw new TypeError("Concurrent model mutation.");
      active.set(entity, undefined);
      const promise = run(async () => {
        const joined = await ownership.joined((boundary) => {
          active.set(entity, boundary);
          return work();
        });
        if (!joined.body.ok) throw joined.body.error;
        return joined.body.value;
      });
      void promise.then(
        () => {
          active.delete(entity);
        },
        () => {
          active.delete(entity);
        },
      );
      return promise;
    },
  };
}

export type { BindingPorts, ModelBinding, Session };
export { attachBindingPorts, createMutationPorts, getBindingPorts };

const sessionIdentityKey: unique symbol = Symbol("database.session.identity");
interface SessionIdentity {
  readonly self: Session;
  readonly configuredPool: object;
  readonly transactional: boolean;
  readonly tenant: unknown;
  readonly signal: AbortSignal;
  readonly assertActive: () => void;
  readonly run: <T>(work: () => T | Promise<T>) => Promise<T>;
  readonly app: object;
  readonly execution: object;
  readonly pool: object;
}
function attachSessionIdentity(session: Session, identity: Omit<SessionIdentity, "self">): void {
  Object.defineProperty(session, sessionIdentityKey, {
    value: Object.freeze({ ...identity, self: session }),
  });
}
function assertSameSessionSelection(expected: Session, selected: Session): void {
  const owner = Object.getOwnPropertyDescriptor(expected, sessionIdentityKey)?.value as
    | SessionIdentity
    | undefined;
  const candidate = Object.getOwnPropertyDescriptor(selected, sessionIdentityKey)?.value as
    | SessionIdentity
    | undefined;
  if (
    !owner ||
    !candidate ||
    owner.self !== expected ||
    candidate.self !== selected ||
    owner.app !== candidate.app ||
    owner.execution !== candidate.execution ||
    owner.pool !== candidate.pool
  ) {
    throw new TypeError(
      "Database policy selection belongs to a different application, execution or pool.",
    );
  }
}

export { assertSameSessionSelection, attachSessionIdentity };

interface SessionOwnerIdentity {
  readonly app: object;
  readonly configuredPool: object;
}
function assertOwnedSession(
  owner: SessionOwnerIdentity,
  selected: Session,
  requireTransaction = false,
): Readonly<{ signal: AbortSignal; tenant: unknown }> {
  const identity = Object.getOwnPropertyDescriptor(selected, sessionIdentityKey)?.value as
    | SessionIdentity
    | undefined;
  if (
    !identity ||
    identity.self !== selected ||
    identity.app !== owner.app ||
    identity.configuredPool !== owner.configuredPool ||
    (requireTransaction && !identity.transactional)
  )
    throw new PersistenceError("DATABASE_TRANSACTION_SCOPE");
  identity.assertActive();
  return Object.freeze({ signal: identity.signal, tenant: identity.tenant });
}

export type { SessionOwnerIdentity };
export { assertOwnedSession };

interface ConfiguredPoolIdentity {
  readonly driver: DatabaseDriver;
  readonly max: number | undefined;
}
interface DatabaseOwnership {
  readonly app: object;
  readonly connections: Readonly<Record<string, ConfiguredPoolIdentity>>;
}
const DATABASE_OWNERSHIP_TOKEN = createServiceToken<DatabaseOwnership>("core.database.ownership");
function createDatabaseOwnership(
  config: Readonly<Record<string, DatabaseConnectionOptions>>,
): DatabaseOwnership {
  const connections: Record<string, ConfiguredPoolIdentity> = Object.create(null);
  for (const [name, options] of Object.entries(config))
    connections[name] = Object.freeze({
      driver: options.driver,
      max: options.driver === "sqlite" ? undefined : options.max,
    });
  return Object.freeze({ app: Object.freeze({}), connections: Object.freeze(connections) });
}

export type { ConfiguredPoolIdentity, DatabaseOwnership };
export { createDatabaseOwnership, DATABASE_OWNERSHIP_TOKEN };

interface TransactionLineage {
  readonly owner: SessionOwnerIdentity;
  readonly live: () => boolean;
  readonly parent: TransactionLineage | undefined;
}
const transactionLineage = new AsyncLocalStorage<TransactionLineage>();
/** Diagnostic denial only; this store never selects or revives persistence authority. */
function runWithTransactionLineage<T>(
  owner: SessionOwnerIdentity,
  live: () => boolean,
  invoke: () => T,
): T {
  return transactionLineage.run(
    {
      owner,
      live,
      parent: transactionLineage.getStore(),
    },
    invoke,
  );
}
function assertNoOwnedTransaction(
  owner: SessionOwnerIdentity,
  message:
    | "Outbox coordination must run outside business transactions."
    | "SQL observations require an independent transaction." = "Outbox coordination must run outside business transactions.",
): void {
  for (let current = transactionLineage.getStore(); current; current = current.parent) {
    if (
      current.owner.app === owner.app &&
      current.owner.configuredPool === owner.configuredPool &&
      current.live()
    )
      throw new Error(message);
  }
}
function runOwnedSession<T>(
  owner: SessionOwnerIdentity,
  selected: Session,
  work: () => T | Promise<T>,
): Promise<T> {
  assertOwnedSession(owner, selected);
  const identity = Object.getOwnPropertyDescriptor(selected, sessionIdentityKey)
    ?.value as SessionIdentity;
  return identity.run(work);
}

export { assertNoOwnedTransaction, runOwnedSession, runWithTransactionLineage };
