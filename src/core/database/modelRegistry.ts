import { assertServicePayload } from "@getstrata/core/contracts/services";
import type { AnyServiceToken } from "@getstrata/core/contracts/token";
import { serviceTokenKey } from "@getstrata/core/contracts/token";
import type {
  AfterCommitRepositoryContext,
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
  RepositoryEffectsDeclaration,
  RepositoryHooks,
} from "@getstrata/core/database/definitions";
import {
  assertDefinition,
  assertRepositoryEffectsDeclaration,
} from "@getstrata/core/database/definitions";
import {
  attachBindingPorts,
  attachSessionIdentity,
  type BindingPorts,
  createMutationPorts,
  type Session,
} from "#strata-orm-internal";
import {
  BaseRepository,
  createBoundModel,
  getModelBinding,
  getRepositoryBinding,
  Model,
} from "#strata-orm-runtime";
import type { ExecutionContext } from "../contracts/application";
import type { OwnedExecution } from "../contracts/executionOwnership";
import { EventBus } from "../events/eventBusClass";
import { createScopedPolicy } from "../tenant/scopedDatabasePolicy";
import type { RawPool } from "./driverPorts";
import type { DatabaseSession } from "./session";
import type { TransactionSession } from "./transactionSession";

type Row = Record<string, unknown>;
type Repo = BaseRepository<Row, string>;
type Entity = Model<Row, string>;
type RepoDef = RepositoryDefinition<Row, string, Repo>;
interface PreparedRepository {
  readonly definition: AnyRepositoryDefinition;
  readonly dependencies: readonly unknown[];
  readonly bus: EventBus;
}
interface PreparedModel {
  readonly definition: AnyModelDefinition;
  readonly dependencies: readonly unknown[];
  readonly observers: readonly ModelObserver<unknown>[];
}
interface PreparedRegistry {
  readonly app: object;
  readonly repositories: ReadonlyMap<AnyRepositoryDefinition, PreparedRepository>;
  readonly models: ReadonlyMap<AnyModelDefinition, PreparedModel>;
  readonly names: ReadonlyMap<string, AnyModelDefinition>;
}
interface RegistrySnapshot {
  readonly repositories: readonly AnyRepositoryDefinition[];
  readonly models: readonly AnyModelDefinition[];
  readonly dependencies: readonly AnyServiceToken[];
  readonly repositoryEffects: readonly RepositoryEffectsDeclaration[];
}
function definitionArray<T>(values: readonly T[]): readonly T[] {
  if (!Array.isArray(values)) throw new TypeError("Database definitions must be arrays.");
  const copied: T[] = [];
  for (let index = 0; index < values.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !("value" in descriptor))
      throw new TypeError("Definition array accessors and holes are unsupported.");
    copied.push(descriptor.value);
  }
  return Object.freeze(copied);
}
function snapshotRegistry(
  repositories: readonly AnyRepositoryDefinition[] = [],
  models: readonly AnyModelDefinition[] = [],
  repositoryEffects: readonly RepositoryEffectsDeclaration[] = [],
): RegistrySnapshot {
  repositories = definitionArray(repositories);
  models = definitionArray(models);
  repositoryEffects = definitionArray(repositoryEffects);
  const repos = new Set<AnyRepositoryDefinition>();
  const repoNames = new Set<string>();
  const names = new Set<string>();
  const definitions = new Set<AnyModelDefinition>();
  const dependencies: AnyServiceToken[] = [];
  const add = (token: AnyServiceToken) => {
    if (!dependencies.some((existing) => serviceTokenKey(existing) === serviceTokenKey(token)))
      dependencies.push(token);
  };
  for (const definition of repositories) {
    assertDefinition(definition, "repository");
    if (repos.has(definition) || repoNames.has(definition.name))
      throw new TypeError("Duplicate repository definition.");
    repos.add(definition);
    repoNames.add(definition.name);
    definition.dependencies.forEach(add);
    for (const effect of definition.effects) {
      if (effect.transactional) add(effect.transactional);
      if (effect.afterCommit) add(effect.afterCommit);
    }
  }
  for (const declaration of repositoryEffects) {
    assertRepositoryEffectsDeclaration(declaration);
    assertDefinition(declaration.definition, "repository");
    if (!repos.has(declaration.definition))
      throw new TypeError("Effect repository is not registered.");
    for (const effect of declaration.effects) {
      if (effect.transactional) add(effect.transactional);
      if (effect.afterCommit) add(effect.afterCommit);
    }
  }
  for (const definition of models) {
    assertDefinition(definition, "model");
    if (definitions.has(definition) || !repos.has(definition.repository))
      throw new TypeError("Duplicate model or unregistered repository.");
    definitions.add(definition);
    for (const name of [definition.name, ...definition.aliases]) {
      if (names.has(name)) throw new TypeError("Duplicate model alias.");
      names.add(name);
    }
    const columns = definition.repository.table.columns as readonly string[];
    for (const key of ["fillable", "guarded"] as const) {
      const values = definition.attributes[key];
      if (Array.isArray(values) && values.some((value) => !columns.includes(value)))
        throw new TypeError("Unknown model attribute column.");
    }
    for (const key of Object.keys(definition.attributes.casts ?? {}))
      if (!columns.includes(key)) throw new TypeError("Unknown cast column.");
    definition.dependencies.forEach(add);
    definition.observers.forEach(add);
  }
  return Object.freeze({
    repositories: Object.freeze([...repositories]),
    models: Object.freeze([...models]),
    dependencies: Object.freeze(dependencies),
    repositoryEffects,
  });
}
function prepareRegistry(
  snapshot: RegistrySnapshot,
  values: readonly unknown[],
  app: object,
): PreparedRegistry {
  const supplied = new Map(
    snapshot.dependencies.map((token, index) => [serviceTokenKey(token), values[index]]),
  );
  const resolve = (token: AnyServiceToken) => supplied.get(serviceTokenKey(token));
  const repositories = new Map<AnyRepositoryDefinition, PreparedRepository>();
  for (const definition of snapshot.repositories) {
    const bus = new EventBus();
    for (const effect of [
      ...definition.effects,
      ...snapshot.repositoryEffects
        .filter((item) => item.definition === definition)
        .flatMap((item) => item.effects),
    ]) {
      if (effect.transactional) {
        const listener = resolve(effect.transactional);
        if (typeof listener !== "function")
          throw new TypeError("Transactional listener must be a function.");
        bus.listenTransactional(effect.action, listener as (value: unknown) => Promise<void>);
      }
      if (effect.afterCommit) {
        const listener = resolve(effect.afterCommit);
        if (typeof listener !== "function")
          throw new TypeError("After-commit listener must be a function.");
        bus.listen(effect.action, async (payload) => {
          const p = payload as { row: Row; context: AfterCommitRepositoryContext };
          await listener(p.row, p.context);
        });
      }
    }
    repositories.set(
      definition,
      Object.freeze({
        definition,
        dependencies: Object.freeze(definition.dependencies.map(resolve)),
        bus,
      }),
    );
  }
  const models = new Map<AnyModelDefinition, PreparedModel>();
  const names = new Map<string, AnyModelDefinition>();
  for (const definition of snapshot.models) {
    models.set(
      definition,
      Object.freeze({
        definition,
        dependencies: Object.freeze(definition.dependencies.map(resolve)),
        observers: Object.freeze(
          definition.observers.map(resolve),
        ) as readonly ModelObserver<unknown>[],
      }),
    );
    for (const name of [definition.name, ...definition.aliases]) names.set(name, definition);
  }
  return Object.freeze({ app, repositories, models, names });
}
interface SessionAuthority {
  readonly pool: RawPool;
  readonly branch: object;
  readonly transactional: boolean;
  readonly assertActive: () => void;
  readonly run: <T>(work: () => T | Promise<T>) => Promise<T>;
  readonly registerRestore: (restore: () => undefined) => void;
  readonly root: () => DatabaseSession;
}
interface BoundRegistry {
  repository<R extends object, K extends keyof R & string, T extends BaseRepository<R, K>>(
    definition: RepositoryDefinition<R, K, T>,
  ): T;
  model<R extends object, K extends keyof R & string, M extends Model<R, K>>(
    definition: ModelDefinition<R, K, M>,
  ): BoundModel<R, K, M>;
}
/** One closure per execution; every facade attaches exactly one constructor cache. */
function createBoundRegistryFactory(
  prepared: PreparedRegistry,
  context: ExecutionContext,
  ownership: OwnedExecution,
  configuredPool: (pool: RawPool) => object,
) {
  const attachments = new WeakMap<Session, BoundRegistry>();
  const execution = Object.freeze({});
  return {
    attach(session: Session, authority: SessionAuthority): BoundRegistry {
      if (attachments.has(session)) throw new TypeError("Session already attached.");
      const repositories = new Map<AnyRepositoryDefinition, Repo>();
      const models = new Map<AnyModelDefinition, BoundModel<Row, string, Entity>>();
      const mutation = createMutationPorts(ownership, authority.assertActive);
      const tenant = context.tenant;
      const registry: BoundRegistry = {
        repository<R extends object, K extends keyof R & string, T extends BaseRepository<R, K>>(
          definition: RepositoryDefinition<R, K, T>,
        ): T {
          authority.assertActive();
          assertDefinition(definition, "repository");
          const erased = definition as unknown as AnyRepositoryDefinition;
          const template = prepared.repositories.get(erased);
          if (!template) throw new TypeError("Repository is not registered in this application.");
          const cached = repositories.get(erased);
          if (cached) return cached as unknown as T;
          const binding = makeBinding(erased) as unknown as RepositoryBinding<R, K>;
          const result = (
            template.definition.create as unknown as (
              binding: RepositoryBinding<R, K>,
              ...dependencies: unknown[]
            ) => T
          )(binding, ...template.dependencies);
          assertServicePayload(result);
          if (!(result instanceof BaseRepository) || getRepositoryBinding(result) !== binding)
            throw new TypeError("Repository constructor returned the wrong binding.");
          repositories.set(erased, result as unknown as Repo);
          return result;
        },
        model<R extends object, K extends keyof R & string, M extends Model<R, K>>(
          definition: ModelDefinition<R, K, M>,
        ): BoundModel<R, K, M> {
          authority.assertActive();
          assertDefinition(definition, "model");
          const erased = definition as unknown as AnyModelDefinition;
          const template = prepared.models.get(erased);
          if (!template) throw new TypeError("Model is not registered in this application.");
          const cached = models.get(erased);
          if (cached) return cached as unknown as BoundModel<R, K, M>;
          const binding = makeBinding(erased.repository, template) as unknown as ModelBinding<
            R,
            K,
            BaseRepository<R, K>
          >;
          // R is the registered physical row; M extends Model<R,K>. The implementation
          // retains legacy conditional generic overloads whose covariance TS cannot prove.
          const facade = createBoundModel<R, K, M>(binding) as unknown as BoundModel<R, K, M>;
          models.set(erased, facade as unknown as BoundModel<Row, string, Entity>);
          return facade;
        },
      };
      function makeBinding(
        definition: AnyRepositoryDefinition,
        model?: PreparedModel,
      ): RepositoryBinding<Row, string> {
        const template = prepared.repositories.get(definition);
        if (!template) throw new TypeError("Repository not registered.");
        const binding = {
          session,
          table: definition.table,
          dialect: authority.pool.dialect,
          capabilities: authority.pool.capabilities,
          run: authority.run,
          ...(model
            ? {
                definition: model.definition,
                repository: registry.repository(definition as unknown as RepoDef),
              }
            : {}),
        } as unknown as RepositoryBinding<Row, string>;
        const ports: BindingPorts<Row, string> = {
          app: prepared.app,
          pool: authority.pool,
          branch: authority.branch,
          tenant,
          definition,
          hooks: definition.hooks as RepositoryHooks<Row, string> | undefined,
          assertActive: authority.assertActive,
          repository: registry.repository,
          model: <R extends object, K extends keyof R & string, M extends Model<R, K>>(
            value: ModelDefinition<R, K, M> | string,
          ) => {
            const def = typeof value === "string" ? prepared.names.get(value) : value;
            if (!def) throw new TypeError("Unknown related model.");
            return registry.model(def as unknown as ModelDefinition<R, K, M>);
          },
          reselect: <T extends Repo>(child: Session) =>
            child.repository(definition as unknown as RepoDef) as T,
          assertMutation: (action) => {
            authority.assertActive();
            if (template.bus.hasTransactionalListeners(action) && !authority.transactional)
              throw new TypeError("Transactional listeners require an explicit transaction.");
          },
          mutation: <V>(
            action: RepositoryAction,
            work: (repository: Repo) => V | Promise<V>,
          ): Promise<V> => {
            ports.assertMutation(action);
            if (!template.bus.hasTransactionalListeners(action))
              return authority.run(() =>
                work(registry.repository(definition as unknown as RepoDef)),
              );
            return session.transaction((child) =>
              work(child.repository(definition as unknown as RepoDef)),
            );
          },
          publish: async (action, row) => {
            authority.assertActive();
            const copied = Object.freeze({ ...row });
            if (template.bus.hasTransactionalListeners(action)) {
              await template.bus.dispatchTransactional(
                action,
                Object.freeze({
                  session: session as TransactionSession,
                  definition,
                  action,
                  row: copied,
                }),
              );
            }
            // EventBus has no public listener-presence probe; absent dispatch is a no-op.
            const after = () => {
              const database = authority.root();
              const publicationContext: AfterCommitRepositoryContext = Object.freeze({
                database,
                execution: context,
                policy: createScopedPolicy(ownership, context, database),
              });
              return template.bus.dispatch(action, { row: copied, context: publicationContext });
            };
            if (authority.transactional) (session as TransactionSession).afterCommit(after);
            else await after();
          },
          registerRestore: authority.registerRestore,
          mutate: <V>(entity: object, work: () => V | Promise<V>) =>
            mutation.mutate(entity, authority.run, work),
          assertEditable: mutation.assertEditable,
          assertBindable: mutation.assertBindable,
          dehydrate: model?.definition.attributes.dehydrate
            ? (values) =>
                (
                  model.definition.attributes.dehydrate as unknown as (
                    values: Readonly<Partial<Row>>,
                    ...deps: unknown[]
                  ) => Partial<Row> | Promise<Partial<Row>>
                )(values, ...model.dependencies)
            : undefined,
          observers: model?.observers ?? [],
          scopes: model
            ? model.definition.scopes.map(
                (scope) => (query: unknown) =>
                  (scope as unknown as (query: unknown, ...deps: unknown[]) => unknown)(
                    query,
                    ...model.dependencies,
                  ),
              )
            : [],
          modelDefinition: model?.definition,
          construct: model
            ? (state: ModelState<Row>, source: Entity | undefined) => {
                authority.assertActive();
                const result = (
                  model.definition.construct as unknown as (
                    state: ModelState<Row>,
                    binding: RepositoryBinding<Row, string>,
                    source: Entity | undefined,
                    ...deps: unknown[]
                  ) => Entity
                )(state, binding, source, ...model.dependencies);
                assertServicePayload(result);
                if (!(result instanceof Model) || getModelBinding(result) !== binding)
                  throw new TypeError("Model constructor returned the wrong binding.");
                return result;
              }
            : undefined,
        };
        return attachBindingPorts(binding, ports);
      }
      attachSessionIdentity(session, {
        app: prepared.app,
        execution,
        pool: authority.pool,
        configuredPool: configuredPool(authority.pool),
        transactional: authority.transactional,
        tenant: context.tenant,
        signal: context.signal,
        assertActive: authority.assertActive,
        run: authority.run,
      });
      attachments.set(session, registry);
      return registry;
    },
  };
}

export type { ModelObserver } from "@getstrata/core/database/definitions";
export type { BoundRegistry, PreparedRegistry, RegistrySnapshot, SessionAuthority };
export { createBoundRegistryFactory, prepareRegistry, snapshotRegistry };
