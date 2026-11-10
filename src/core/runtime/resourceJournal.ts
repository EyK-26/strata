import type {
  ApplicationDiagnostic,
  CleanupContext,
  OpenOutcome,
  ResourcePhase,
  ResourceSpec,
} from "../contracts/application";

type Hook = (context: CleanupContext) => void | Promise<void>;
type AcquisitionSettlement =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };
type HookResult = { readonly ok: true } | { readonly ok: false; readonly error: unknown };
type Attempt = {
  readonly promise: Promise<boolean>;
  order: number;
  result?: HookResult;
};
type Resource = {
  name: string;
  group: ResourceGroup;
  order: number;
  status: "opening" | "acquired" | "released" | "discharged" | "unknown";
  hooks: Partial<Record<ResourcePhase, Hook>>;
  attempts: Map<ResourcePhase, Attempt>;
  acquisition?: Promise<AcquisitionSettlement>;
  internalCleanupErrors: readonly unknown[];
};
export type ResourceGroup = {
  readonly key: symbol;
  readonly name: string;
  readonly requires: readonly symbol[];
};
export type ExecutionResourceTemplate = {
  readonly key: symbol;
  readonly name: string;
  readonly requires: readonly symbol[];
};
export type ExecutionResources = {
  acquire<T>(
    template: ExecutionResourceTemplate,
    spec: ResourceSpec<T>,
    signal: AbortSignal,
    validate?: (value: T) => void,
    check?: () => void,
  ): Promise<T>;
  createRootTaskGroup(): ResourceGroup;
  finalize(context: CleanupContext): Promise<TaskResourceResult>;
};
export type TaskResourceResult = {
  readonly acquisitionFailures: readonly unknown[];
  readonly cleanupFailures: readonly unknown[];
  readonly retained: boolean;
};
type TaskGroup = {
  sealed: boolean;
  finalization?: Promise<TaskResourceResult>;
};
type Observer = {
  record(diagnostic: ApplicationDiagnostic): void;
  changed(): void;
};

/** The sole acquisition and lifecycle engine for static and task-owned resources. */
export class ResourceJournal {
  private readonly resources = new Map<symbol, Resource>();
  private readonly definitions = new Map<symbol, ResourceGroup>();
  private readonly providerOrder = new Map<symbol, number>();
  private readonly taskGroups = new WeakMap<ResourceGroup, TaskGroup>();
  private readonly taskKeys = new Set<symbol>();
  private readonly staticKeys: readonly symbol[];
  private nextResource = 0;
  private nextGroup = 0;
  private nextHook = 0;
  private unsafe = false;

  constructor(
    groups: readonly ResourceGroup[],
    private readonly observer: Observer,
  ) {
    this.staticKeys = Object.freeze(groups.map((group) => group.key));
    for (const group of groups) {
      this.definitions.set(group.key, group);
      this.providerOrder.set(group.key, this.nextGroup++);
    }
  }

  createTaskGroup(parent?: ResourceGroup): ResourceGroup {
    if (
      parent &&
      (!this.definitions.has(parent.key) || this.taskGroups.get(parent)?.sealed !== false)
    ) {
      throw new Error("Task resource parent is not admitting children.");
    }
    return this.registerDynamicGroup("execution task", parent ? [parent.key] : this.staticKeys);
  }

  createExecutionResources(templates: readonly ExecutionResourceTemplate[]): ExecutionResources {
    const keys = new Map(templates.map((template) => [template.key, Symbol()]));
    const groups = new Map<symbol, ResourceGroup>();
    for (const template of templates) {
      groups.set(
        template.key,
        this.registerDynamicGroup(
          template.name,
          [...this.staticKeys, ...template.requires.map((key) => keys.get(key) ?? key)],
          keys.get(template.key),
        ),
      );
    }
    let finalization: Promise<TaskResourceResult> | undefined;
    return Object.freeze({
      acquire: <T>(
        template: ExecutionResourceTemplate,
        spec: ResourceSpec<T>,
        signal: AbortSignal,
        validate?: (value: T) => void,
        check?: () => void,
      ) => this.acquire(groups.get(template.key) as ResourceGroup, spec, signal, validate, check),
      createRootTaskGroup: () => {
        if (finalization) throw new Error("Execution resources are no longer admitting tasks.");
        return this.registerDynamicGroup("execution task", [
          ...this.staticKeys,
          ...[...groups.values()].map((group) => group.key),
        ]);
      },
      finalize: (context: CleanupContext) => {
        finalization ??= this.finalizeGroups([...groups.values()], context);
        return finalization;
      },
    });
  }

  private registerDynamicGroup(
    name: string,
    requires: readonly symbol[],
    key = Symbol(),
  ): ResourceGroup {
    const group = Object.freeze({ key, name, requires: Object.freeze([...requires]) });
    this.definitions.set(group.key, group);
    this.providerOrder.set(group.key, this.nextGroup++);
    this.taskGroups.set(group, { sealed: false });
    this.taskKeys.add(group.key);
    return group;
  }

  sealGroup(group: ResourceGroup): void {
    (this.taskGroups.get(group) as TaskGroup).sealed = true;
  }

  finalizeGroup(group: ResourceGroup, context: CleanupContext): Promise<TaskResourceResult> {
    const state = this.taskGroups.get(group) as TaskGroup;
    state.finalization ??= this.finalizeGroups([group], context);
    return state.finalization;
  }

  private finalizeGroups(
    groups: readonly ResourceGroup[],
    context: CleanupContext,
  ): Promise<TaskResourceResult> {
    const selected = new Set(groups.map((group) => group.key));
    for (const group of groups) this.sealGroup(group);
    return Promise.resolve().then(async () => {
      const resources = [...this.resources.values()].filter((resource) =>
        selected.has(resource.group.key),
      );
      const acquisitions = await Promise.all(
        resources.map((resource) => resource.acquisition as Promise<AcquisitionSettlement>),
      );
      for (const resource of this.reverseResources(selected))
        await this.hook(resource, "stop", context);
      for (const resource of this.reverseResources(selected))
        await this.hook(resource, "drain", context);
      await this.flushAndClose(context, selected);
      // A concurrent global sweep can already own an attempt; join its actual result too.
      await Promise.all(
        resources.flatMap((resource) =>
          [...resource.attempts.values()].map((attempt) => attempt.promise),
        ),
      );
      const acquisitionFailures: unknown[] = [];
      for (const acquisition of acquisitions) {
        if (!acquisition.ok) acquisitionFailures.push(acquisition.error);
      }
      const cleanupFailures = resources.flatMap((resource) => [...resource.internalCleanupErrors]);
      const attempts = resources.flatMap((resource) => [...resource.attempts.values()]);
      attempts.sort((left, right) => left.order - right.order);
      for (const attempt of attempts) {
        if (attempt.result && !attempt.result.ok) cleanupFailures.push(attempt.result.error);
      }
      const retained = resources.some(
        (resource) => resource.status === "acquired" || resource.status === "unknown",
      );
      const result = Object.freeze({
        acquisitionFailures: Object.freeze(acquisitionFailures),
        cleanupFailures: Object.freeze(cleanupFailures),
        retained,
      });
      // The copied ledger outlives clean records; failed cleanup diagnostics live with the app.
      for (const [key, resource] of this.resources) {
        if (
          selected.has(resource.group.key) &&
          (resource.status === "released" || resource.status === "discharged")
        ) {
          this.resources.delete(key);
        }
      }
      this.pruneGroups();
      this.observer.changed();
      return result;
    });
  }

  acquire<T>(
    group: ResourceGroup,
    spec: ResourceSpec<T>,
    signal: AbortSignal,
    validate?: (value: T) => void,
    check?: () => void,
  ): Promise<T> {
    let resource: Resource;
    let open: ResourceSpec<T>["open"];
    let close: ResourceSpec<T>["close"];
    let stop: ResourceSpec<T>["stop"];
    let drain: ResourceSpec<T>["drain"];
    let flush: ResourceSpec<T>["flush"];
    try {
      if (this.definitions.get(group.key) !== group || this.taskGroups.get(group)?.sealed) {
        throw new Error("Resource owner is not admitting acquisitions.");
      }
      const name = dataField(spec, "name", true);
      declarationName(name);
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
      check?.();
      if (signal.aborted) throw signal.reason;
      // Reflection/checkpoints may reenter acquisition or seal this owner.
      if (this.definitions.get(group.key) !== group || this.taskGroups.get(group)?.sealed) {
        throw new Error("Resource owner is not admitting acquisitions.");
      }
      if (
        [...this.resources.values()].some(
          (item) => item.group.key === group.key && item.name === name,
        )
      ) {
        throw new Error(`Duplicate resource name: ${name}.`);
      }
      resource = {
        name,
        group,
        order: this.nextResource++,
        status: "opening",
        hooks: {},
        attempts: new Map(),
        internalCleanupErrors: [],
      };
      this.resources.set(Symbol(), resource);
    } catch (error) {
      return observed(Promise.reject(error));
    }
    // Hook values are captured before open; mutable declarations cannot replace them.
    const result = observed(
      Promise.resolve().then(async () => {
        try {
          const outcome = openOutcome<T>(await open(signal));
          if (!outcome.ok) {
            resource.status = outcome.disposition === "unknown" ? "unknown" : "discharged";
            resource.internalCleanupErrors = outcome.cleanupErrors ?? [];
            this.record("acquisition", "ACQUISITION_FAILED", outcome.error, resource);
            for (const error of resource.internalCleanupErrors) {
              this.record(
                "cleanup",
                "INTERNAL_ACQUISITION_CLEANUP_FAILED",
                error,
                resource,
                "close",
              );
            }
            this.observer.changed();
            throw outcome.error;
          }
          const value = outcome.value;
          resource.status = "acquired";
          resource.hooks.close = (context) => close(value, context);
          if (stop) resource.hooks.stop = (context) => stop(value, context);
          if (drain) resource.hooks.drain = (context) => drain(value, context);
          if (flush) resource.hooks.flush = (context) => flush(value, context);
          this.observer.changed();
          // Validation failure keeps the actual acquired handle and its captured hooks.
          validate?.(value);
          check?.();
          if (signal.aborted) throw signal.reason;
          return value;
        } catch (error) {
          if (resource.status === "opening") {
            resource.status = "unknown";
            this.record("acquisition", "ACQUISITION_OUTCOME_UNKNOWN", error, resource);
            this.observer.changed();
          }
          throw error;
        }
      }),
    );
    resource.acquisition = result.then<AcquisitionSettlement, AcquisitionSettlement>(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    this.observer.changed();
    return result;
  }

  async scanStop(context: CleanupContext): Promise<boolean> {
    let safe = true;
    for (const resource of this.reverseResources()) {
      if (!(await this.hook(resource, "stop", context))) safe = false;
    }
    return safe && !this.unsafe;
  }

  async drain(context: CleanupContext): Promise<boolean> {
    let safe = true;
    for (const resource of this.reverseResources()) {
      // A selected finalizer may have started a late producer after scanStop's snapshot.
      if (!(await this.hook(resource, "stop", context))) safe = false;
      if (!(await this.hook(resource, "drain", context))) safe = false;
    }
    return safe && !this.unsafe;
  }

  async flushAndClose(context: CleanupContext, selected?: ReadonlySet<symbol>): Promise<void> {
    let blocked = this.blockedGroups(selected);
    for (const resource of this.reverseResources(selected)) {
      if (!blocked.has(resource.group.key)) await this.hook(resource, "flush", context);
    }
    for (const resource of this.reverseResources(selected)) {
      // Other selected finalizers may have failed while a flush was pending.
      blocked = this.blockedGroups(selected);
      if (blocked.has(resource.group.key)) continue;
      await this.hook(resource, "close", context);
    }
  }

  view() {
    const resources = [...this.resources.values()];
    return Object.freeze({
      pendingAcquisitions: Object.freeze(
        resources.filter((item) => item.status === "opening").map((item) => item.name),
      ),
      retainedResources: Object.freeze(
        resources
          .filter((item) => item.status === "acquired" || item.status === "unknown")
          .map((item) => item.name),
      ),
      unstopped: resources.some(
        (resource) =>
          resource.status === "acquired" &&
          resource.hooks.stop !== undefined &&
          resource.attempts.get("stop")?.result === undefined,
      ),
      unsafe: this.unsafe,
      resourceCount: resources.length,
      groupCount: this.definitions.size,
      taskGroupCount: this.taskKeys.size,
    });
  }

  private groupResources(group: ResourceGroup): Resource[] {
    return [...this.resources.values()].filter((resource) => resource.group === group);
  }

  private blockedGroups(selected?: ReadonlySet<symbol>): Set<symbol> {
    const blocked = new Set<symbol>();
    for (const resource of this.resources.values()) {
      if (
        resource.status === "unknown" ||
        [...resource.attempts.entries()].some(
          ([phase, attempt]) => phase !== "flush" && attempt.result?.ok === false,
        )
      ) {
        this.blockDependencies(resource.group.key, blocked);
      } else if (
        selected &&
        !selected.has(resource.group.key) &&
        (resource.status === "acquired" || resource.status === "opening")
      ) {
        for (const dependency of resource.group.requires)
          this.blockDependencies(dependency, blocked);
      }
    }
    return blocked;
  }

  private blockDependencies(provider: symbol, blocked: Set<symbol>): void {
    if (blocked.has(provider)) return;
    blocked.add(provider);
    for (const dependency of this.definitions.get(provider)?.requires ?? []) {
      this.blockDependencies(dependency, blocked);
    }
  }

  private reverseResources(selected?: ReadonlySet<symbol>): Resource[] {
    return [...this.resources.values()]
      .filter((resource) => !selected || selected.has(resource.group.key))
      .sort(
        (left, right) =>
          (this.providerOrder.get(right.group.key) ?? 0) -
            (this.providerOrder.get(left.group.key) ?? 0) || right.order - left.order,
      );
  }

  private hook(
    resource: Resource,
    phase: ResourcePhase,
    context: CleanupContext,
  ): Promise<boolean> {
    const existing = resource.attempts.get(phase);
    if (existing) return existing.promise;
    const handler = resource.hooks[phase];
    if (resource.status !== "acquired" || !handler) return Promise.resolve(true);
    // Install the attempt before invoking caller code, including synchronous reentry.
    const attempt: Attempt = {
      order: -1,
      promise: Promise.resolve().then(async () => {
        attempt.order = this.nextHook++;
        try {
          await handler(context);
          attempt.result = { ok: true };
          if (phase === "close") resource.status = "released";
          this.observer.changed();
          return true;
        } catch (error) {
          attempt.result = { ok: false, error };
          if (phase === "stop" || phase === "drain") this.unsafe = true;
          this.record("cleanup", "RESOURCE_CLEANUP_FAILED", error, resource, phase);
          this.observer.changed();
          return false;
        }
      }),
    };
    resource.attempts.set(phase, attempt);
    return attempt.promise;
  }

  private pruneGroups(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const key of this.taskKeys) {
        const group = this.definitions.get(key) as ResourceGroup;
        const state = this.taskGroups.get(group) as TaskGroup;
        if (
          !state.sealed ||
          this.groupResources(group).length > 0 ||
          [...this.definitions.values()].some((item) => item.requires.includes(key))
        )
          continue;
        this.taskKeys.delete(key);
        this.definitions.delete(key);
        this.providerOrder.delete(key);
        changed = true;
      }
    }
  }

  private record(
    kind: ApplicationDiagnostic["kind"],
    code: string,
    error: unknown,
    resource: Resource,
    phase?: ResourcePhase,
  ): void {
    const diagnostic = Object.freeze({
      kind,
      code,
      error,
      provider: resource.group.name,
      resource: resource.name,
      ...(phase ? { phase } : {}),
    });
    if (
      kind === "acquisition" &&
      this.taskKeys.has(resource.group.key) &&
      resource.status !== "unknown"
    )
      return;
    this.observer.record(diagnostic);
  }
}

/** Observe the original promise; do not replace it or change its rejection semantics. */
function observed<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
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
