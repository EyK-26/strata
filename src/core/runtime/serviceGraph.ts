import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import { CORE_EXECUTION_OPERATIONS_TOKEN } from "@getstrata/core/contracts/executionOperations";
import { CORE_EXECUTION_OWNERSHIP_TOKEN } from "@getstrata/core/contracts/executionOwnership";
import {
  aliasService,
  isServiceDeclaration,
  resourceService,
  type ServiceDeclaration,
  type ServiceLifetime,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import {
  type AnyServiceToken,
  assertServiceToken,
  type ServiceToken,
  serviceTokenKey,
  serviceTokenName,
} from "@getstrata/core/contracts/token";
import type { ResourceSpec } from "../contracts/application";
import type { ServiceContainer } from "../contracts/container";
import type { ExecutionResourceTemplate, ResourceGroup, ResourceJournal } from "./resourceJournal";

type ResourceAcquisition = Pick<ResourceJournal, "acquire">;

class ServiceGraphError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new ServiceGraphError(`SERVICE_GRAPH_${code}`);
}

function field(record: unknown, name: string): unknown {
  if (record === null || typeof record !== "object") return fail("INVALID_DECLARATION");
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  if (!descriptor || !("value" in descriptor)) return fail("INVALID_DECLARATION");
  return descriptor.value;
}

function declaration(input: unknown): ServiceDeclaration {
  const kind = field(input, "kind");
  const token = field(input, "token");
  assertServiceToken(token);
  const typed = token as ServiceToken<unknown>;
  let normalized: ServiceDeclaration;
  if (kind === "value") {
    if (field(input, "lifetime") !== "application") return fail("INVALID_LIFETIME");
    normalized = valueService(typed, field(input, "value"));
  } else if (kind === "alias") {
    const target = field(input, "target");
    assertServiceToken(target);
    normalized = aliasService(typed, target as ServiceToken<unknown>);
  } else {
    if (kind !== "factory" && kind !== "resource") return fail("INVALID_DECLARATION");
    const lifetime = field(input, "lifetime");
    if (lifetime !== "application" && lifetime !== "execution") return fail("INVALID_LIFETIME");
    const dependencies = field(input, "dependencies");
    const create = field(input, "create");
    if (!Array.isArray(dependencies) || typeof create !== "function") {
      return fail("INVALID_DECLARATION");
    }
    if (kind === "resource") {
      normalized = resourceService(typed, {
        lifetime,
        dependencies,
        create: create as (...values: unknown[]) => ResourceSpec<unknown>,
      });
    } else {
      normalized = service(typed, {
        lifetime,
        dependencies,
        create: create as (...values: unknown[]) => unknown,
      });
    }
  }
  if (!isServiceDeclaration(input)) return fail("INVALID_DECLARATION");
  return normalized;
}

function dependencies(item: ServiceDeclaration): readonly AnyServiceToken[] {
  if (item.kind === "alias") return [item.target];
  return item.kind === "factory" || item.kind === "resource" ? item.dependencies : [];
}

/** Definitions and order only. ServiceContainer owns every initialized value and promise. */
interface ServiceGraph {
  readonly resourceGroups: readonly ResourceGroup[];
  readonly executionResourceTemplates: readonly ExecutionResourceTemplate[];
  start(
    container: ServiceContainer,
    signal: AbortSignal,
    acquisition: ResourceAcquisition,
  ): Promise<void>;
  startExecution(
    container: ServiceContainer,
    signal: AbortSignal,
    checkpoint?: () => void,
    acquisition?: ResourceAcquisition,
  ): Promise<void>;
}

function compileServiceGraph(
  declarations: readonly ServiceDeclaration[] = [],
  overrides: readonly ServiceDeclaration[] = [],
): ServiceGraph {
  if (!Array.isArray(declarations) || !Array.isArray(overrides)) return fail("INVALID_DECLARATION");
  const implicit = new Set([
    serviceTokenKey(CORE_EXECUTION_CONTEXT_TOKEN),
    serviceTokenKey(CORE_EXECUTION_OPERATIONS_TOKEN),
    serviceTokenKey(CORE_EXECUTION_OWNERSHIP_TOKEN),
  ]);
  const nodes = new Map<symbol, ServiceDeclaration>();
  for (const input of declarations) {
    const item = declaration(input);
    const key = serviceTokenKey(item.token);
    if (implicit.has(key)) return fail("RESERVED_TOKEN");
    if (nodes.has(key)) return fail("DUPLICATE_TOKEN");
    nodes.set(key, item);
  }
  const replaced = new Set<symbol>();
  for (const input of overrides) {
    const item = declaration(input);
    const key = serviceTokenKey(item.token);
    if (implicit.has(key)) return fail("RESERVED_TOKEN");
    if (!nodes.has(key)) return fail("UNKNOWN_OVERRIDE");
    if (replaced.has(key)) return fail("DUPLICATE_OVERRIDE");
    replaced.add(key);
    nodes.set(key, item);
  }
  for (const item of nodes.values()) {
    for (const dependency of dependencies(item)) {
      if (!implicit.has(serviceTokenKey(dependency)) && !nodes.has(serviceTokenKey(dependency)))
        return fail("MISSING_DEPENDENCY");
    }
  }
  const remaining = [...nodes.values()];
  const ordered: ServiceDeclaration[] = [];
  const lifetimes = new Map<symbol, ServiceLifetime>([
    [serviceTokenKey(CORE_EXECUTION_CONTEXT_TOKEN), "execution"],
    [serviceTokenKey(CORE_EXECUTION_OPERATIONS_TOKEN), "execution"],
    [serviceTokenKey(CORE_EXECUTION_OWNERSHIP_TOKEN), "execution"],
  ]);
  while (remaining.length > 0) {
    const index = remaining.findIndex((item) =>
      dependencies(item).every((dependency) => lifetimes.has(serviceTokenKey(dependency))),
    );
    if (index === -1) return fail("CYCLE");
    const item = remaining.splice(index, 1)[0] as ServiceDeclaration;
    const lifetime =
      item.kind === "alias"
        ? (lifetimes.get(serviceTokenKey(item.target)) as ServiceLifetime)
        : item.lifetime;
    lifetimes.set(serviceTokenKey(item.token), lifetime);
    ordered.push(item);
  }
  // Validate final lifetimes after aliases and overrides have been resolved.
  for (const item of ordered) {
    if (lifetimes.get(serviceTokenKey(item.token)) !== "application") continue;
    if (
      dependencies(item).some(
        (dependency) => lifetimes.get(serviceTokenKey(dependency)) === "execution",
      )
    ) {
      return fail("CAPTIVE_DEPENDENCY");
    }
  }
  Object.freeze(ordered);
  const backing = new Map<symbol, readonly symbol[]>();
  const resourceGroups: ResourceGroup[] = [];
  const executionResourceTemplates: ExecutionResourceTemplate[] = [];
  const resourceOwners = new Map<symbol, ResourceGroup>();
  for (const item of ordered) {
    const closure = new Set<symbol>();
    for (const dependency of dependencies(item)) {
      for (const key of backing.get(serviceTokenKey(dependency)) ?? []) closure.add(key);
    }
    if (item.kind === "resource") {
      const group: ResourceGroup = Object.freeze({
        key: Symbol(),
        name: serviceTokenName(item.token),
        requires: Object.freeze([...closure]),
      });
      if (item.lifetime === "application") resourceGroups.push(group);
      else executionResourceTemplates.push(group);
      resourceOwners.set(serviceTokenKey(item.token), group);
      closure.add(group.key);
    }
    backing.set(serviceTokenKey(item.token), Object.freeze([...closure]));
  }
  Object.freeze(resourceGroups);
  Object.freeze(executionResourceTemplates);
  async function initialize(
    container: ServiceContainer,
    signal: AbortSignal,
    lifetime: ServiceLifetime,
    checkpoint?: () => void,
    acquisition?: ResourceAcquisition,
  ): Promise<void> {
    // Eager sequential initialization stops at the first rejection; stage accounting relies on it.
    for (const item of ordered) {
      if (lifetimes.get(serviceTokenKey(item.token)) !== lifetime) continue;
      checkpoint?.();
      if (signal.aborted) throw signal.reason;
      const token = item.token as ServiceToken<unknown>;
      if (item.kind === "value") container.set(token, item.value);
      else if (item.kind === "alias") container.alias(token, item.target as ServiceToken<unknown>);
      else {
        await container.initialize(
          token,
          () => {
            const values = item.dependencies.map((dependency) =>
              container.resolve(dependency as ServiceToken<unknown>),
            );
            const value = (item.create as (...values: unknown[]) => unknown)(...values);
            if (item.kind !== "resource") return value;
            // Descriptor assembly may itself cancel startup. No new admission follows it.
            checkpoint?.();
            if (signal.aborted) throw signal.reason;
            return (acquisition as ResourceAcquisition).acquire(
              resourceOwners.get(serviceTokenKey(item.token)) as ResourceGroup,
              value as ResourceSpec<unknown>,
              signal,
              (payload) => {
                valueService(token, payload);
              },
              checkpoint,
            );
          },
          signal,
          checkpoint,
        );
      }
    }
    checkpoint?.();
    if (signal.aborted) throw signal.reason;
    container.seal();
  }
  return Object.freeze({
    resourceGroups,
    executionResourceTemplates,
    start: (container: ServiceContainer, signal: AbortSignal, acquisition: ResourceAcquisition) =>
      initialize(container, signal, "application", undefined, acquisition),
    startExecution: (
      container: ServiceContainer,
      signal: AbortSignal,
      checkpoint?: () => void,
      acquisition?: ResourceAcquisition,
    ) => initialize(container, signal, "execution", checkpoint, acquisition),
  });
}

export type { ServiceGraph };
export { compileServiceGraph };
