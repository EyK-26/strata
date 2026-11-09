import { ServiceContainer } from "@getstrata/core/contracts/container";
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
  OpenOutcome,
  ProviderDefinition,
  ProviderScope,
  ResourcePhase,
  ResourceSpec,
  StopResult,
} from "../contracts/application";
import type { ServiceToken } from "../contracts/token";
import { compileServiceGraph, type ServiceGraph } from "./serviceGraph";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: unknown): void;
};
type Hook = (context: CleanupContext) => void | Promise<void>;
type Resource = {
  name: string;
  provider: string;
  order: number;
  status: "opening" | "acquired" | "released" | "discharged" | "unknown";
  hooks: Partial<Record<ResourcePhase, Hook>>;
  attempted: Set<ResourcePhase>;
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

/** Adapter records contain data fields; interpreting one never invokes an accessor. */
function dataField(record: object, key: string, required = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if ((!descriptor && (required || key in record)) || (descriptor && !("value" in descriptor))) {
    throw new TypeError("Application adapter records must declare own data fields.");
  }
  return descriptor?.value;
}

function openOutcome<T>(value: unknown): OpenOutcome<T> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Resource open must return an explicit outcome.");
  }
  const ok = dataField(value, "ok", true);
  if (ok === true) return { ok, value: dataField(value, "value", true) as T };
  const disposition = dataField(value, "disposition", true);
  if (
    ok !== false ||
    (disposition !== "unknown" && disposition !== "not-acquired" && disposition !== "cleaned")
  ) {
    throw new TypeError("Resource open returned an invalid outcome disposition.");
  }
  const errors = dataField(value, "cleanupErrors");
  if (errors !== undefined && !Array.isArray(errors)) {
    throw new TypeError("Acquisition cleanup errors must be an array.");
  }
  return {
    ok: false,
    error: dataField(value, "error", true),
    disposition,
    cleanupErrors: errors === undefined ? [] : [...errors],
  };
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
  private readonly resources = new Map<string, Resource>();
  private readonly definitions = new Map<string, ProviderDefinition>();
  private readonly providerOrder = new Map<string, number>();
  private readonly transportNames = new Set<string>();
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
  private nextResource = 0;

  constructor(private readonly definition: Definition) {
    this.completion = this.completed.promise;
    for (const [index, item] of [...definition.providers, ...definition.transports].entries()) {
      this.definitions.set(item.name, item);
      this.providerOrder.set(item.name, index);
    }
    for (const item of definition.transports) this.transportNames.add(item.name);
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

  run<T>(work: (scope: CommandScope) => T | Promise<T>): Promise<T> {
    if (this.phase !== "ready") {
      return observed(Promise.reject(new ApplicationStateError("APPLICATION_NOT_READY", this.id)));
    }
    let active = true;
    const scope: CommandScope = Object.freeze({
      applicationId: this.id,
      config: this.definition.config,
      signal: this.cancellation.signal,
      resolve: <T>(token: ServiceToken<T>): T => {
        if (!active) throw new ApplicationStateError("APPLICATION_SCOPE_EXPIRED", this.id);
        return this.services.resolve(token);
      },
    });
    const operation = leasedOperation(
      () => work(scope),
      () => {
        active = false;
      },
    );
    const result = operation.promise;
    this.commands.add(result);
    void result.then(
      () => this.commandSettled(result),
      () => this.commandSettled(result),
    );
    void Promise.resolve().then(() => operation.invoke());
    return result;
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
            const result = this.acquire(provider.name, spec);
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

  private acquire<T>(provider: string, spec: ResourceSpec<T>): Promise<T> {
    let resource: Resource;
    let open: ResourceSpec<T>["open"];
    let close: ResourceSpec<T>["close"];
    let stop: ResourceSpec<T>["stop"];
    let drain: ResourceSpec<T>["drain"];
    let flush: ResourceSpec<T>["flush"];
    try {
      const name = dataField(spec, "name", true);
      declarationName(name);
      if (this.resources.has(name)) throw new Error(`Duplicate resource name: ${name}.`);
      open = dataField(spec, "open", true) as ResourceSpec<T>["open"];
      close = dataField(spec, "close", true) as ResourceSpec<T>["close"];
      stop = dataField(spec, "stop") as ResourceSpec<T>["stop"];
      drain = dataField(spec, "drain") as ResourceSpec<T>["drain"];
      flush = dataField(spec, "flush") as ResourceSpec<T>["flush"];
      if (typeof open !== "function" || typeof close !== "function") {
        throw new TypeError("Owned resources must declare open and close functions.");
      }
      for (const hook of [stop, drain, flush]) {
        if (hook !== undefined && typeof hook !== "function") {
          throw new TypeError("Resource lifecycle hooks must be functions.");
        }
      }
      resource = {
        name,
        provider,
        order: this.nextResource++,
        status: "opening",
        hooks: {},
        attempted: new Set(),
      };
      this.resources.set(resource.name, resource);
      this.publish();
    } catch (error) {
      return observed(Promise.reject(error));
    }
    // The validated hook values are captured before open; mutable declarations cannot replace them.
    return observed(
      Promise.resolve().then(async () => {
        try {
          const outcome = openOutcome<T>(await open(this.cancellation.signal));
          if (!outcome.ok) {
            resource.status = outcome.disposition === "unknown" ? "unknown" : "discharged";
            this.record("acquisition", "ACQUISITION_FAILED", outcome.error, resource);
            for (const error of outcome.cleanupErrors ?? []) {
              this.record(
                "cleanup",
                "INTERNAL_ACQUISITION_CLEANUP_FAILED",
                error,
                resource,
                "close",
              );
            }
            this.publish();
            throw outcome.error;
          }
          const value = outcome.value;
          resource.status = "acquired";
          resource.hooks.close = (context) => close(value, context);
          if (stop) resource.hooks.stop = (context) => stop(value, context);
          if (drain) resource.hooks.drain = (context) => drain(value, context);
          if (flush) resource.hooks.flush = (context) => flush(value, context);
          this.publish();
          if (this.cancellation.signal.aborted) throw this.cancelled;
          return value;
        } catch (error) {
          if (resource.status === "opening") {
            resource.status = "unknown";
            this.record("acquisition", "ACQUISITION_OUTCOME_UNKNOWN", error, resource);
            this.publish();
          }
          throw error;
        }
      }),
    );
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

  private reverseResources(): Resource[] {
    return [...this.resources.values()].sort(
      (left, right) =>
        (this.providerOrder.get(right.provider) ?? 0) -
          (this.providerOrder.get(left.provider) ?? 0) || right.order - left.order,
    );
  }

  private async finishCleanup(context: CleanupContext): Promise<void> {
    let unsafe = false;
    // New outcomes from already-reserved acquisitions can still add a producer.
    for (;;) {
      const changed = this.changed.promise;
      for (const resource of this.reverseResources()) {
        if (!(await this.hook(resource, "stop", context))) unsafe = true;
      }
      const unstopped = [...this.resources.values()].some(
        (resource) =>
          resource.status === "acquired" &&
          resource.hooks.stop !== undefined &&
          !resource.attempted.has("stop"),
      );
      if (!this.startupRunning && !this.hasOpeningResource() && !unstopped) break;
      await changed;
    }
    for (const resource of this.reverseResources()) {
      if (!(await this.hook(resource, "drain", context))) unsafe = true;
    }
    while (this.commands.size > 0) await this.changed.promise;

    const blocked = new Set<string>();
    for (const resource of this.resources.values()) {
      if (resource.status === "unknown") this.blockDependencies(resource.provider, blocked);
    }
    if (!unsafe) {
      for (const resource of this.reverseResources()) {
        if (!blocked.has(resource.provider)) await this.hook(resource, "flush", context);
      }
      for (const resource of this.reverseResources()) {
        if (blocked.has(resource.provider)) continue;
        if (!(await this.hook(resource, "close", context))) {
          this.blockDependencies(resource.provider, blocked);
        }
      }
    }
    const retained = [...this.resources.values()].some(
      (resource) => resource.status === "acquired" || resource.status === "unknown",
    );
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

  private hasOpeningResource(): boolean {
    return [...this.resources.values()].some((resource) => resource.status === "opening");
  }

  private blockDependencies(provider: string, blocked: Set<string>): void {
    if (blocked.has(provider)) return;
    blocked.add(provider);
    if (this.transportNames.has(provider)) {
      for (const item of this.definition.providers) this.blockDependencies(item.name, blocked);
    }
    for (const dependency of this.definitions.get(provider)?.requires ?? []) {
      this.blockDependencies(dependency, blocked);
    }
  }

  private async hook(
    resource: Resource,
    phase: ResourcePhase,
    context: CleanupContext,
  ): Promise<boolean> {
    const handler = resource.hooks[phase];
    if (resource.status !== "acquired" || !handler || resource.attempted.has(phase)) return true;
    resource.attempted.add(phase);
    try {
      await handler(context);
      if (phase === "close") resource.status = "released";
      this.publish();
      return true;
    } catch (error) {
      this.record("cleanup", "RESOURCE_CLEANUP_FAILED", error, resource, phase);
      this.publish();
      return false;
    }
  }

  private recordPrimary(error: unknown): void {
    if (!this.hasPrimary) {
      this.hasPrimary = true;
      this.primary = error;
    }
    this.record("startup", "APPLICATION_START_FAILED", error);
  }

  private record(
    kind: ApplicationDiagnostic["kind"],
    code: string,
    error: unknown,
    resource?: Resource,
    phase?: ResourcePhase,
  ): void {
    this.diagnostics.push(
      Object.freeze({
        kind,
        code,
        error,
        ...(resource ? { provider: resource.provider, resource: resource.name } : {}),
        ...(phase ? { phase } : {}),
      }),
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
    const resources = [...this.resources.values()];
    return Object.freeze({
      phase: this.phase,
      boot: this.boot,
      cleanup: this.cleanup,
      pendingAcquisitions: Object.freeze(
        resources.filter((item) => item.status === "opening").map((item) => item.name),
      ),
      retainedResources: Object.freeze(
        resources
          .filter((item) => item.status === "acquired" || item.status === "unknown")
          .map((item) => item.name),
      ),
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
export { createApplication };
