import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import {
  CORE_EXECUTION_OPERATIONS_TOKEN,
  type ExecutionOperations,
} from "@getstrata/core/contracts/executionOperations";
import {
  CORE_EXECUTION_OWNERSHIP_TOKEN,
  type Joined,
  type OwnedBoundary,
  type OwnedExecution,
  type OwnedInvocation,
} from "@getstrata/core/contracts/executionOwnership";
import { assertServicePayload, type NonPromisePayload } from "@getstrata/core/contracts/services";
import { copyApplicationConfig } from "../config/configSnapshot";
import type {
  Application,
  ApplicationConfig,
  ApplicationDefinition,
  ApplicationDiagnostic,
  ApplicationPhase,
  ApplicationSnapshot,
  BootDisposition,
  CleanupContext,
  CleanupDisposition,
  CommandScope,
  CompletionResult,
  ExecutionContext,
  ExecutionEnvelope,
  ProviderDefinition,
  ProviderScope,
  ResourceSpec,
  StopResult,
} from "../contracts/application";
import type { ServiceToken } from "../contracts/token";
import { normalizeExecutionEnvelope, ownExecutionContext } from "./executionContext";
import {
  completeExecution,
  type Settlement,
  settleExecutionTasks,
  type TaskResources,
} from "./executionTasks";
import { type ResourceGroup, ResourceJournal } from "./resourceJournal";
import { compileServiceGraph, type ServiceGraph } from "./serviceGraph";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: unknown): void;
};
type Definition = {
  config: ApplicationConfig;
  providers: readonly ProviderDefinition[];
  transports: readonly ProviderDefinition[];
  shutdownTimeoutMs: number;
  startupCleanupTimeoutMs: number;
  services: ServiceGraph;
};
type TaskFrame = {
  readonly application: object;
  readonly context: ExecutionContext;
  readonly lease: { active: boolean };
  readonly operation: ExecutionOperations["operation"];
  readonly joined: OwnedExecution["joined"];
  readonly path: readonly symbol[];
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Observe the original promise; do not replace it or change its rejection semantics. */
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}

function timeout(value: number | undefined): number {
  const result = value === undefined ? 30_000 : value;
  if (!Number.isSafeInteger(result) || result <= 0 || result > 2_147_483_647) {
    throw new RangeError(
      "Application cleanup timeout must be an integer between 1 and 2147483647.",
    );
  }
  return result;
}

/** Descriptor inspection does not execute a caller's then getter. */
function mayBeThenable(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  try {
    let current: object | null = value;
    const visited = new Set<object>();
    while (current !== null) {
      if (visited.has(current)) return true;
      visited.add(current);
      const then = Object.getOwnPropertyDescriptor(current, "then");
      if (then) return !("value" in then) || typeof then.value === "function";
      current = Object.getPrototypeOf(current);
    }
    return false;
  } catch {
    // Descriptor visibility is only a synchronous-expiration optimization. Native
    // Promise normalization remains authoritative for opaque/proxy return values.
    return true;
  }
}

function leasedOperation<T>(work: () => T | Promise<T>, close: () => void) {
  const result = deferred<T>();
  observed(result.promise);
  void result.promise.then(close, close);
  return {
    promise: result.promise,
    fail(error: unknown): void {
      close();
      result.reject(error);
    },
    invoke(): void {
      try {
        const value = work();
        if (!mayBeThenable(value)) close();
        // Native assimilation reads a callable/accessor candidate; no manual then read.
        result.resolve(value);
      } catch (error) {
        close();
        result.reject(error);
      }
    },
  };
}

function declarationName(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Provider and resource names must be nonempty strings.");
  }
}

function normalize(input: ApplicationDefinition): Definition {
  const copied = copyApplicationConfig(input.config === undefined ? {} : input.config);
  if (copied === null || typeof copied !== "object" || Array.isArray(copied)) {
    throw new TypeError("Application config must be a plain object.");
  }
  const names = new Set<string>();
  const copy = (items: readonly ProviderDefinition[]): ProviderDefinition[] => {
    if (!Array.isArray(items)) throw new TypeError("Application providers must be an array.");
    return items.map((item) => {
      declarationName(item.name);
      if (names.has(item.name)) throw new Error(`Duplicate provider name: ${item.name}.`);
      if (typeof item.setup !== "function")
        throw new TypeError("Provider setup must be a function.");
      if (item.requires !== undefined && !Array.isArray(item.requires)) {
        throw new TypeError("Provider dependencies must be an array.");
      }
      if (item.services !== undefined && !Array.isArray(item.services)) {
        throw new TypeError("Provider services must be an array.");
      }
      if (item.boot !== undefined && typeof item.boot !== "function") {
        throw new TypeError("Provider boot must be a function.");
      }
      const requires = [...(item.requires ?? [])];
      for (const dependency of requires) declarationName(dependency);
      names.add(item.name);
      return Object.freeze({
        name: item.name,
        setup: item.setup,
        ...(item.boot ? { boot: item.boot } : {}),
        services: Object.freeze([...(item.services ?? [])]),
        requires: Object.freeze(requires),
      });
    });
  };
  const providers = copy(input.providers);
  const transports = copy(input.transports === undefined ? [] : input.transports);
  const transportNames = new Set(transports.map((item) => item.name));
  for (const item of [...providers, ...transports]) {
    for (const dependency of item.requires ?? []) {
      if (!names.has(dependency)) throw new Error(`Missing provider dependency: ${dependency}.`);
      if (!transportNames.has(item.name) && transportNames.has(dependency)) {
        throw new Error("Providers cannot depend on transports that start after them.");
      }
    }
  }
  const complete = new Set<string>();
  const order = (items: ProviderDefinition[]): readonly ProviderDefinition[] => {
    const remaining = [...items];
    const result: ProviderDefinition[] = [];
    while (remaining.length > 0) {
      const index = remaining.findIndex((item) =>
        (item.requires ?? []).every((dependency) => complete.has(dependency)),
      );
      if (index === -1) throw new Error("Application provider dependency cycle.");
      // findIndex identified an existing element in this unchanged array.
      const item = remaining.splice(index, 1)[0] as ProviderDefinition;
      complete.add(item.name);
      result.push(item);
    }
    return Object.freeze(result);
  };
  const orderedProviders = order(providers);
  const orderedTransports = order(transports);
  return {
    config: copied as ApplicationConfig,
    providers: orderedProviders,
    transports: orderedTransports,
    shutdownTimeoutMs: timeout(input.shutdownTimeoutMs),
    startupCleanupTimeoutMs: timeout(input.startupCleanupTimeoutMs),
    services: compileServiceGraph(
      [
        ...(input.services ?? []),
        ...providers.flatMap((item) => item.services ?? []),
        ...transports.flatMap((item) => item.services ?? []),
      ],
      input.overrides,
    ),
  };
}

class ApplicationStateError extends Error {
  constructor(
    readonly code: string,
    readonly applicationId: string,
  ) {
    super(code);
  }
}

class OwnedApplication implements Application {
  private readonly taskStorage = new AsyncLocalStorage<TaskFrame | undefined>();
  readonly id = crypto.randomUUID();
  readonly completion: Promise<CompletionResult>;
  private readonly completed = deferred<CompletionResult>();
  private readonly cancellation = new AbortController();
  private readonly cleanupCancellation = new AbortController();
  private readonly cancelled = new ApplicationStateError("APPLICATION_START_CANCELLED", this.id);
  private readonly journal: ResourceJournal;
  private readonly providerGroups = new Map<ProviderDefinition, ResourceGroup>();
  private readonly commands = new Set<Promise<unknown>>();
  private readonly services = new ServiceContainer();
  private readonly diagnostics: ApplicationDiagnostic[] = [];
  private changed = deferred<void>();
  private phase: ApplicationPhase = "constructed";
  private boot: BootDisposition = "not-started";
  private cleanup: CleanupDisposition = "not-required";
  private snapshot: ApplicationSnapshot;
  private startup?: Deferred<void>;
  private terminalStartup?: Promise<void>;
  private stopping?: Deferred<StopResult>;
  private startupRunning = false;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private timedOut = false;
  private hasPrimary = false;
  private primary: unknown;

  constructor(private readonly definition: Definition) {
    this.completion = this.completed.promise;
    const providerKeys = new Map(
      [...definition.providers, ...definition.transports].map((item) => [item.name, Symbol()]),
    );
    const managedKeys = definition.services.resourceGroups.map((group) => group.key);
    const providerKeysOnly = definition.providers.map(
      (item) => providerKeys.get(item.name) as symbol,
    );
    for (const item of [...definition.providers, ...definition.transports]) {
      this.providerGroups.set(
        item,
        Object.freeze({
          key: providerKeys.get(item.name) as symbol,
          name: item.name,
          requires: Object.freeze([
            ...managedKeys,
            ...(definition.transports.includes(item) ? providerKeysOnly : []),
            ...(item.requires ?? []).map((name) => providerKeys.get(name) as symbol),
          ]),
        }),
      );
    }
    const groups = Object.freeze([
      ...definition.services.resourceGroups,
      ...this.providerGroups.values(),
    ]);
    this.journal = new ResourceJournal(groups, {
      record: (diagnostic) => this.diagnostics.push(diagnostic),
      changed: () => this.publish(),
    });
    this.snapshot = this.makeSnapshot();
  }

  get state(): ApplicationSnapshot {
    return this.snapshot;
  }

  start(): Promise<void> {
    if (this.phase === "stopping" || this.phase === "stopped" || this.phase === "failed") {
      this.terminalStartup ??= observed(
        Promise.reject(new ApplicationStateError("APPLICATION_TERMINAL", this.id)),
      );
      return this.terminalStartup;
    }
    if (this.startup) return this.startup.promise;
    this.startup = deferred<void>();
    observed(this.startup.promise);
    this.phase = "starting";
    this.boot = "pending";
    this.cleanup = "open";
    this.startupRunning = true;
    this.publish();
    // The promise and state already exist when synchronous or reentrant user work runs.
    void Promise.resolve().then(() => this.taskStorage.run(undefined, () => this.startProviders()));
    return this.startup.promise;
  }

  stop(options: { readonly reason?: string } = {}): Promise<StopResult> {
    return this.taskStorage.run(undefined, () =>
      this.beginStop(options.reason ?? "shutdown", this.definition.shutdownTimeoutMs),
    );
  }

  run<T>(work: (scope: CommandScope) => T | Promise<T>): Promise<T>;
  run<T>(envelope: ExecutionEnvelope, work: (scope: CommandScope) => T | Promise<T>): Promise<T>;
  run<T>(
    input: ExecutionEnvelope | ((scope: CommandScope) => T | Promise<T>),
    callback?: (scope: CommandScope) => T | Promise<T>,
  ): Promise<T> {
    return this.taskStorage.run(undefined, () => {
      if (this.phase !== "ready") {
        return observed(
          Promise.reject(new ApplicationStateError("APPLICATION_NOT_READY", this.id)),
        );
      }
      let envelope: ExecutionEnvelope;
      let work: (scope: CommandScope) => T | Promise<T>;
      try {
        const candidate = typeof input === "function" && callback === undefined ? input : callback;
        if (typeof candidate !== "function")
          throw new TypeError("Execution callback must be a function.");
        work = candidate;
        envelope = normalizeExecutionEnvelope(
          typeof input === "function" && callback === undefined ? { kind: "command" } : input,
        );
        // Reflection during normalization can synchronously reenter application.stop().
        if (this.phase !== "ready" || this.cancellation.signal.aborted) {
          throw new ApplicationStateError("APPLICATION_NOT_READY", this.id);
        }
      } catch (error) {
        return observed(Promise.reject(error));
      }
      const result = deferred<T>();
      observed(result.promise);
      // Reserve the entire initialization and callback attempt before any user factory runs.
      this.commands.add(result.promise);
      void result.promise.then(
        () => this.commandSettled(result.promise),
        () => this.commandSettled(result.promise),
      );
      void this.execute(envelope, work).then(result.resolve, result.reject);
      return result.promise;
    });
  }

  private async execute<T>(
    envelope: ExecutionEnvelope,
    work: (scope: CommandScope) => T | Promise<T>,
  ): Promise<T> {
    const owner = ownExecutionContext(envelope, this.id, this.cancellation.signal);
    try {
      const { context } = owner;
      if (this.phase !== "ready" || this.cancellation.signal.aborted) {
        throw new ApplicationStateError("APPLICATION_NOT_READY", this.id);
      }
      owner.check();
      const services = new ServiceContainer(this.services);
      services.set(CORE_EXECUTION_CONTEXT_TOKEN, context);
      const identityFrame = (): TaskFrame => {
        const frame = this.taskStorage.getStore();
        if (
          !frame ||
          frame.application !== this ||
          frame.context !== context ||
          !frame.lease.active
        ) {
          throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
        }
        return frame;
      };
      const activeFrame = (): TaskFrame => {
        const frame = identityFrame();
        owner.check();
        return frame;
      };
      const operations: ExecutionOperations = Object.freeze({
        assertActive: () => {
          activeFrame();
        },
        operation: <T>(work: () => T | Promise<T>): Promise<T> => {
          try {
            return activeFrame().operation(work);
          } catch (error) {
            return observed(Promise.reject(error));
          }
        },
      });
      services.set(CORE_EXECUTION_OPERATIONS_TOKEN, operations);
      const ownership: OwnedExecution = Object.freeze({
        joined: <T>(
          work: (task: OwnedBoundary) => T | Promise<T>,
          enter?: OwnedInvocation,
        ): Promise<Joined<T>> => {
          try {
            return activeFrame().joined(work, enter);
          } catch (error) {
            return observed(Promise.reject(error));
          }
        },
      });
      services.set(CORE_EXECUTION_OWNERSHIP_TOKEN, ownership);
      const executionResources = this.journal.createExecutionResources(
        this.definition.services.executionResourceTemplates,
      );
      const cleanupContext = Object.freeze({
        signal: this.cleanupCancellation.signal,
        reason: "task-complete",
      });
      const bindingCleanupContext = Object.freeze({
        signal: this.cleanupCancellation.signal,
        reason: "execution-complete",
      });
      let initialization: { readonly ok: true } | { readonly ok: false; readonly error: unknown };
      try {
        await this.definition.services.startExecution(services, context.signal, owner.check, {
          acquire: <T>(
            template: ResourceGroup,
            spec: ResourceSpec<T>,
            signal: AbortSignal,
            validate?: (value: T) => void,
            check?: () => void,
          ) => executionResources.acquire(template, spec, signal, validate, check),
        });
        owner.check();
        initialization = { ok: true };
      } catch (error) {
        initialization = { ok: false, error };
      }
      const taskResources = (parent?: ResourceGroup): TaskResources => {
        const group = parent
          ? this.journal.createTaskGroup(parent)
          : executionResources.createRootTaskGroup();
        return Object.freeze({
          acquire: <T>(spec: ResourceSpec<T> & NonPromisePayload<T>) =>
            this.journal.acquire(group, spec, context.signal, assertServicePayload, owner.check),
          child: () => taskResources(group),
          seal: () => this.journal.sealGroup(group),
          finalize: () =>
            this.taskStorage.run(undefined, () =>
              this.journal.finalizeGroup(group, cleanupContext),
            ),
        });
      };
      const callbacks: Settlement<T> = initialization.ok
        ? await settleExecutionTasks(
            work,
            owner.check,
            (body, spawn, resources, dispatch) => {
              const lease = { active: true };
              const frame: TaskFrame = Object.freeze({
                application: this,
                context,
                lease,
                operation: dispatch.operation,
                joined: dispatch.joined,
                path: dispatch.path,
              });
              const scope: CommandScope = Object.freeze({
                applicationId: this.id,
                config: this.definition.config,
                context,
                signal: context.signal,
                resolve: <T>(token: ServiceToken<T>): T => {
                  if (!lease.active)
                    throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
                  return services.resolve(token);
                },
                acquire: <T>(spec: ResourceSpec<T> & NonPromisePayload<T>): Promise<T> => {
                  try {
                    if (!lease.active)
                      throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
                    owner.check();
                    return resources.acquire(spec);
                  } catch (error) {
                    return observed(Promise.reject(error));
                  }
                },
                spawn: <T>(childWork: (scope: CommandScope) => T | Promise<T>) => {
                  if (!lease.active) {
                    return observed(
                      Promise.reject(
                        new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id),
                      ),
                    );
                  }
                  return spawn(childWork);
                },
              });
              const requireDirect = (): void => {
                if (activeFrame() !== frame)
                  throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
              };
              const boundary: OwnedBoundary = Object.freeze({
                finalize: (work: () => undefined): Promise<Joined<void>> => {
                  try {
                    // Exact direct admission remains required even after cancellation.
                    if (identityFrame() !== frame)
                      throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
                    return dispatch.finalize(work);
                  } catch (error) {
                    return observed(Promise.reject(error));
                  }
                },
                acquire: <T>(spec: ResourceSpec<T> & NonPromisePayload<T>): Promise<T> => {
                  try {
                    requireDirect();
                    return resources.acquire(spec);
                  } catch (error) {
                    return observed(Promise.reject(error));
                  }
                },
                assertWithin: () => {
                  const current = activeFrame();
                  // A live descendant remains authorized after this boundary's body lease closes.
                  if (!current.path.includes(dispatch.path[dispatch.path.length - 1] as symbol))
                    throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
                },
                bindNative: <A extends readonly unknown[], R>(work: (...args: A) => Promise<R>) => {
                  requireDirect();
                  if (typeof work !== "function")
                    throw new TypeError("Native continuation must be a function.");
                  return (...args: A): Promise<R> => {
                    try {
                      // Explicit native delivery restores this exact live owner, even from
                      // an unrelated delivery frame. It never chooses an ambient owner.
                      if (!lease.active)
                        throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
                      return this.taskStorage.run(frame, () => {
                        owner.check();
                        return observed(work(...args));
                      });
                    } catch (error) {
                      return observed(Promise.reject(error));
                    }
                  };
                },
              });
              const bodyOperation = leasedOperation(
                () => body(scope, boundary),
                () => {
                  lease.active = false;
                  resources.seal();
                },
              );
              return {
                promise: bodyOperation.promise,
                // Include reflection and native thenable assimilation, not only body(scope).
                invoke: () =>
                  this.taskStorage.run(dispatch.bookkeeping ? undefined : frame, () => {
                    if (!dispatch.enter) return bodyOperation.invoke();
                    let started = false;
                    let open = true;
                    const protocolError = () =>
                      new Error("Owned invocation must run synchronously exactly once.");
                    const invoke = () => {
                      if (!open) throw protocolError();
                      if (started) {
                        const error = protocolError();
                        dispatch.entryFailed(error);
                        throw error;
                      }
                      started = true;
                      return bodyOperation.invoke();
                    };
                    try {
                      dispatch.enter(invoke);
                      if (!started) bodyOperation.fail(protocolError());
                    } catch (error) {
                      if (started) dispatch.entryFailed(error);
                      else bodyOperation.fail(error);
                    } finally {
                      open = false;
                    }
                  }),
              };
            },
            taskResources(),
            (work) => this.taskStorage.run(undefined, work),
          )
        : {
            invoked: false,
            retained: false,
            body: { ok: false, error: initialization.error },
            failures: [],
          };
      const bindings = await this.taskStorage.run(undefined, () =>
        executionResources.finalize(bindingCleanupContext),
      );
      const failures: unknown[] = [];
      // Initialization is sequential, one acquire per binding, stopping at first failure.
      // Its propagated acquire rejection is already represented by the binding ledger.
      // Parallel/recovering initialization would require a new provenance contract.
      if (!initialization.ok && bindings.acquisitionFailures.length === 0) {
        failures.push(initialization.error);
      }
      for (const failure of bindings.acquisitionFailures) failures.push(failure);
      for (const failure of callbacks.failures) failures.push(failure);
      for (const failure of bindings.cleanupFailures) failures.push(failure);
      return completeExecution({ ...callbacks, failures });
    } finally {
      owner.dispose();
    }
  }

  private commandSettled(promise: Promise<unknown>): void {
    this.commands.delete(promise);
    this.publish();
  }

  private async startProviders(): Promise<void> {
    try {
      await this.definition.services.start(this.services, this.cancellation.signal, {
        acquire: <T>(
          group: ResourceGroup,
          spec: ResourceSpec<T>,
          signal: AbortSignal,
          validate?: (value: T) => void,
        ) => this.journal.acquire(group, spec, signal, validate),
      });
      const hooks = [
        ...this.definition.providers.map((provider) => ({ provider, hook: provider.setup })),
        ...this.definition.providers.flatMap((provider) =>
          provider.boot ? [{ provider, hook: provider.boot }] : [],
        ),
        ...this.definition.transports.flatMap((provider) => [
          { provider, hook: provider.setup },
          ...(provider.boot ? [{ provider, hook: provider.boot }] : []),
        ]),
      ];
      for (const { provider, hook } of hooks) {
        if (this.cancellation.signal.aborted) throw this.cancelled;
        let active = true;
        const acquisitions: Promise<unknown>[] = [];
        const scope: ProviderScope = Object.freeze({
          applicationId: this.id,
          config: this.definition.config,
          signal: this.cancellation.signal,
          resolve: <T>(token: ServiceToken<T>): T => {
            if (!active) throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
            return this.services.resolve(token);
          },
          acquire: <T>(spec: ResourceSpec<T>): Promise<T> => {
            if (!active || this.cancellation.signal.aborted) {
              return observed(Promise.reject(this.cancelled));
            }
            const result = this.journal.acquire(
              this.providerGroups.get(provider) as ResourceGroup,
              spec,
              this.cancellation.signal,
            );
            acquisitions.push(result);
            return result;
          },
        });
        const operation = leasedOperation(
          () => hook(scope),
          () => {
            active = false;
          },
        );
        operation.invoke();
        await operation.promise;
        // Even an unawaited acquisition remains part of this owner's startup attempt.
        for (const acquisition of acquisitions) await acquisition;
      }
      if (this.cancellation.signal.aborted) throw this.cancelled;
      this.phase = "ready";
      this.boot = "ready";
      this.publish();
      this.startup?.resolve();
    } catch (error) {
      if (error !== this.cancelled) {
        this.recordPrimary(error);
        this.boot = "failed";
      }
      this.beginStop("startup-failed", this.definition.startupCleanupTimeoutMs);
    } finally {
      this.startupRunning = false;
      this.publish();
    }
  }

  private beginStop(reason: string, timeoutMs: number): Promise<StopResult> {
    if (this.stopping) return this.stopping.promise;
    this.stopping = deferred<StopResult>();
    this.phase = "stopping";
    if (this.boot === "pending" || this.boot === "not-started") this.boot = "cancelled";
    this.cleanup = "pending";
    const context = Object.freeze({ signal: this.cleanupCancellation.signal, reason });
    this.publish();
    this.stopTimer = setTimeout(() => {
      this.timedOut = true;
      this.cleanupCancellation.abort(
        new ApplicationStateError("APPLICATION_CLEANUP_DEADLINE", this.id),
      );
      this.stopping?.resolve(this.result());
      this.rejectStartup();
    }, timeoutMs);
    // Cache stop and schedule its owner before abort listeners can reenter the handle.
    void Promise.resolve().then(() =>
      this.taskStorage.run(undefined, () => this.finishCleanup(context)),
    );
    this.cancellation.abort(this.cancelled);
    return this.stopping.promise;
  }

  private async finishCleanup(context: CleanupContext): Promise<void> {
    let unsafe = false;
    // New outcomes from already-reserved acquisitions can still add a producer.
    for (;;) {
      const changed = this.changed.promise;
      if (!(await this.journal.scanStop(context))) unsafe = true;
      const view = this.journal.view();
      if (view.unsafe) unsafe = true;
      if (!this.startupRunning && view.pendingAcquisitions.length === 0 && !view.unstopped) break;
      await changed;
    }
    if (!(await this.journal.drain(context))) unsafe = true;
    while (this.commands.size > 0) await this.changed.promise;
    if (this.journal.view().unsafe) unsafe = true;

    if (!unsafe) await this.journal.flushAndClose(context);
    const retained = this.journal.view().retainedResources.length > 0;
    const failed = unsafe || retained || this.diagnostics.some((item) => item.kind === "cleanup");
    this.cleanup = failed ? "failed" : "clean";
    this.phase = this.boot === "failed" || failed ? "failed" : "stopped";
    clearTimeout(this.stopTimer);
    this.publish();
    const result = this.result();
    this.stopping?.resolve(result);
    this.completed.resolve(result);
    this.rejectStartup();
  }

  private recordPrimary(error: unknown): void {
    if (!this.hasPrimary) {
      this.hasPrimary = true;
      this.primary = error;
    }
    this.diagnostics.push(
      Object.freeze({ kind: "startup", code: "APPLICATION_START_FAILED", error }),
    );
  }

  private rejectStartup(): void {
    if (!this.startup || this.boot === "ready") return;
    const primary = this.hasPrimary ? this.primary : this.cancelled;
    const cleanupErrors = this.diagnostics
      .filter((item) => item.kind === "cleanup")
      .map((item) => item.error);
    this.startup.reject(
      cleanupErrors.length > 0
        ? new AggregateError(
            [primary, ...cleanupErrors],
            "Application startup and cleanup failed.",
            {
              cause: primary,
            },
          )
        : primary,
    );
  }

  private result(): StopResult {
    return Object.freeze({
      successful: this.cleanup === "clean",
      timedOut: this.timedOut,
      snapshot: this.snapshot,
    });
  }

  private makeSnapshot(): ApplicationSnapshot {
    const view = this.journal.view();
    return Object.freeze({
      phase: this.phase,
      boot: this.boot,
      cleanup: this.cleanup,
      pendingAcquisitions: view.pendingAcquisitions,
      retainedResources: view.retainedResources,
      errors: Object.freeze([...this.diagnostics]),
    });
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    const changed = this.changed;
    this.changed = deferred<void>();
    changed.resolve();
  }
}

function createApplication(definition: ApplicationDefinition): Application {
  return new OwnedApplication(normalize(definition));
}

export {
  aliasService,
  resourceService,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
export type * from "../contracts/application";
export type * from "../contracts/provider";
export { defineProvider } from "../contracts/provider";
export type * from "../contracts/services";
export { CORE_EXECUTION_CONTEXT_TOKEN, createApplication };
