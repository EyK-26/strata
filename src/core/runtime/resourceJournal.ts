import type {
  ApplicationDiagnostic,
  CleanupContext,
  OpenOutcome,
  ResourcePhase,
  ResourceSpec,
} from "../contracts/application";

type Hook = (context: CleanupContext) => void | Promise<void>;
type Resource = {
  name: string;
  provider: string;
  order: number;
  status: "opening" | "acquired" | "released" | "discharged" | "unknown";
  hooks: Partial<Record<ResourcePhase, Hook>>;
  attempted: Set<ResourcePhase>;
};
type Group = {
  readonly name: string;
  readonly requires: readonly string[];
};
type Observer = {
  record(diagnostic: ApplicationDiagnostic): void;
  changed(): void;
};

/** Private resource ownership engine; application admission and barriers stay with its owner. */
export class ResourceJournal {
  private readonly resources = new Map<string, Resource>();
  private readonly definitions = new Map<string, Group>();
  private readonly providerOrder = new Map<string, number>();
  private nextResource = 0;

  constructor(
    groups: readonly Group[],
    private readonly observer: Observer,
  ) {
    for (const [index, group] of groups.entries()) {
      this.definitions.set(group.name, group);
      this.providerOrder.set(group.name, index);
    }
  }

  acquire<T>(provider: string, spec: ResourceSpec<T>, signal: AbortSignal): Promise<T> {
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
      this.observer.changed();
    } catch (error) {
      return observed(Promise.reject(error));
    }
    // The validated hook values are captured before open; mutable declarations cannot replace them.
    return observed(
      Promise.resolve().then(async () => {
        try {
          const outcome = openOutcome<T>(await open(signal));
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
  }

  async scanStop(context: CleanupContext): Promise<boolean> {
    let safe = true;
    for (const resource of this.reverseResources()) {
      if (!(await this.hook(resource, "stop", context))) safe = false;
    }
    return safe;
  }

  async drain(context: CleanupContext): Promise<boolean> {
    let safe = true;
    for (const resource of this.reverseResources()) {
      if (!(await this.hook(resource, "drain", context))) safe = false;
    }
    return safe;
  }

  async flushAndClose(context: CleanupContext): Promise<void> {
    const blocked = new Set<string>();
    for (const resource of this.resources.values()) {
      if (resource.status === "unknown") this.blockDependencies(resource.provider, blocked);
    }
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
          !resource.attempted.has("stop"),
      ),
    });
  }

  private blockDependencies(provider: string, blocked: Set<string>): void {
    if (blocked.has(provider)) return;
    blocked.add(provider);
    for (const dependency of this.definitions.get(provider)?.requires ?? []) {
      this.blockDependencies(dependency, blocked);
    }
  }

  private reverseResources(): Resource[] {
    return [...this.resources.values()].sort(
      (left, right) =>
        (this.providerOrder.get(right.provider) ?? 0) -
          (this.providerOrder.get(left.provider) ?? 0) || right.order - left.order,
    );
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
      this.observer.changed();
      return true;
    } catch (error) {
      this.record("cleanup", "RESOURCE_CLEANUP_FAILED", error, resource, phase);
      this.observer.changed();
      return false;
    }
  }

  private record(
    kind: ApplicationDiagnostic["kind"],
    code: string,
    error: unknown,
    resource?: Resource,
    phase?: ResourcePhase,
  ): void {
    this.observer.record(
      Object.freeze({
        kind,
        code,
        error,
        ...(resource ? { provider: resource.provider, resource: resource.name } : {}),
        ...(phase ? { phase } : {}),
      }),
    );
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
