import { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
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
  ExecutionEnvelope,
  ProviderDefinition,
  ProviderScope,
  ResourceSpec,
  StopResult,
} from "../contracts/application";
import type { ServiceToken } from "../contracts/token";
import { normalizeExecutionEnvelope, ownExecutionContext } from "./executionContext";
import { runExecutionTasks } from "./executionTasks";
import { ResourceJournal } from "./resourceJournal";
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
      const requires = [...(item.requires ?? [])];
      for (const dependency of requires) declarationName(dependency);
      names.add(item.name);
      return Object.freeze({
        name: item.name,
        setup: item.setup,
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
    services: compileServiceGraph(input.services, input.overrides),
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
  readonly id = crypto.randomUUID();
  readonly completion: Promise<CompletionResult>;
  private readonly completed = deferred<CompletionResult>();
  private readonly cancellation = new AbortController();
  private readonly cleanupCancellation = new AbortController();
  private readonly cancelled = new ApplicationStateError("APPLICATION_START_CANCELLED", this.id);
  private readonly journal: ResourceJournal;
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
    const providerNames = definition.providers.map((item) => item.name);
    const groups = Object.freeze([
      ...definition.providers.map((item) =>
        Object.freeze({ name: item.name, requires: item.requires ?? Object.freeze([]) }),
      ),
      ...definition.transports.map((item) =>
        Object.freeze({
          name: item.name,
          requires: Object.freeze([...providerNames, ...(item.requires ?? [])]),
        }),
      ),
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
    void Promise.resolve().then(() => this.startProviders());
    return this.startup.promise;
  }

  stop(options: { readonly reason?: string } = {}): Promise<StopResult> {
    return this.beginStop(options.reason ?? "shutdown", this.definition.shutdownTimeoutMs);
  }

  run<T>(work: (scope: CommandScope) => T | Promise<T>): Promise<T>;
  run<T>(envelope: ExecutionEnvelope, work: (scope: CommandScope) => T | Promise<T>): Promise<T>;
  run<T>(
    input: ExecutionEnvelope | ((scope: CommandScope) => T | Promise<T>),
    callback?: (scope: CommandScope) => T | Promise<T>,
  ): Promise<T> {
    if (this.phase !== "ready") {
      return observed(Promise.reject(new ApplicationStateError("APPLICATION_NOT_READY", this.id)));
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
      await this.definition.services.startExecution(services, context.signal, owner.check);
      owner.check();
      return await runExecutionTasks(work, owner.check, (body, spawn) => {
        let active = true;
        const scope: CommandScope = Object.freeze({
          applicationId: this.id,
          config: this.definition.config,
          context,
          signal: context.signal,
          resolve: <T>(token: ServiceToken<T>): T => {
            if (!active) throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
            return services.resolve(token);
          },
          spawn: <T>(childWork: (scope: CommandScope) => T | Promise<T>) => {
            if (!active) {
              return observed(
                Promise.reject(new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id)),
              );
            }
            return spawn(childWork);
          },
        });
        return leasedOperation(
          () => body(scope),
          () => {
            active = false;
          },
        );
      });
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
      await this.definition.services.start(this.services, this.cancellation.signal);
      for (const provider of [...this.definition.providers, ...this.definition.transports]) {
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
            const result = this.journal.acquire(provider.name, spec, this.cancellation.signal);
            acquisitions.push(result);
            return result;
          },
        });
        const operation = leasedOperation(
          () => provider.setup(scope),
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
    void Promise.resolve().then(() => this.finishCleanup(context));
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
      if (!this.startupRunning && view.pendingAcquisitions.length === 0 && !view.unstopped) break;
      await changed;
    }
    if (!(await this.journal.drain(context))) unsafe = true;
    while (this.commands.size > 0) await this.changed.promise;

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

export { aliasService, service, valueService } from "@getstrata/core/contracts/services";
export type * from "../contracts/application";
export type * from "../contracts/services";
export { CORE_EXECUTION_CONTEXT_TOKEN, createApplication };
