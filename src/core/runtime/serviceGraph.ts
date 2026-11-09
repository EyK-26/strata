import { CORE_EXECUTION_CONTEXT_TOKEN } from "@getstrata/core/contracts/executionContext";
import {
  aliasService,
  isServiceDeclaration,
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
} from "@getstrata/core/contracts/token";
import type { ServiceContainer } from "../contracts/container";

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
  if (kind === "resource") return fail("UNSUPPORTED_RESOURCE");
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
    if (kind !== "factory") return fail("INVALID_DECLARATION");
    const lifetime = field(input, "lifetime");
    if (lifetime !== "application" && lifetime !== "execution") return fail("INVALID_LIFETIME");
    const dependencies = field(input, "dependencies");
    const create = field(input, "create");
    if (!Array.isArray(dependencies) || typeof create !== "function") {
      return fail("INVALID_DECLARATION");
    }
    normalized = service(typed, {
      lifetime,
      dependencies,
      create: create as (...values: unknown[]) => unknown,
    });
  }
  if (!isServiceDeclaration(input)) return fail("INVALID_DECLARATION");
  return normalized;
}

function dependencies(item: ServiceDeclaration): readonly AnyServiceToken[] {
  if (item.kind === "alias") return [item.target];
  return item.kind === "factory" ? item.dependencies : [];
}

/** Definitions and order only. ServiceContainer owns every initialized value and promise. */
interface ServiceGraph {
  start(container: ServiceContainer, signal: AbortSignal): Promise<void>;
  startExecution(
    container: ServiceContainer,
    signal: AbortSignal,
    checkpoint?: () => void,
  ): Promise<void>;
}

function compileServiceGraph(
  declarations: readonly ServiceDeclaration[] = [],
  overrides: readonly ServiceDeclaration[] = [],
): ServiceGraph {
  if (!Array.isArray(declarations) || !Array.isArray(overrides)) return fail("INVALID_DECLARATION");
  const nodes = new Map<symbol, ServiceDeclaration>();
  for (const input of declarations) {
    const item = declaration(input);
    const key = serviceTokenKey(item.token);
    if (key === serviceTokenKey(CORE_EXECUTION_CONTEXT_TOKEN)) return fail("RESERVED_TOKEN");
    if (nodes.has(key)) return fail("DUPLICATE_TOKEN");
    nodes.set(key, item);
  }
  const replaced = new Set<symbol>();
  for (const input of overrides) {
    const item = declaration(input);
    const key = serviceTokenKey(item.token);
    if (key === serviceTokenKey(CORE_EXECUTION_CONTEXT_TOKEN)) return fail("RESERVED_TOKEN");
    if (!nodes.has(key)) return fail("UNKNOWN_OVERRIDE");
    if (replaced.has(key)) return fail("DUPLICATE_OVERRIDE");
    replaced.add(key);
    nodes.set(key, item);
  }
  for (const item of nodes.values()) {
    for (const dependency of dependencies(item)) {
      if (
        serviceTokenKey(dependency) !== serviceTokenKey(CORE_EXECUTION_CONTEXT_TOKEN) &&
        !nodes.has(serviceTokenKey(dependency))
      )
        return fail("MISSING_DEPENDENCY");
    }
  }
  const remaining = [...nodes.values()];
  const ordered: ServiceDeclaration[] = [];
  const lifetimes = new Map<symbol, ServiceLifetime>([
    [serviceTokenKey(CORE_EXECUTION_CONTEXT_TOKEN), "execution"],
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
  async function initialize(
    container: ServiceContainer,
    signal: AbortSignal,
    lifetime: ServiceLifetime,
    checkpoint?: () => void,
  ): Promise<void> {
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
            return (item.create as (...values: unknown[]) => unknown)(...values);
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
    start: (container: ServiceContainer, signal: AbortSignal) =>
      initialize(container, signal, "application"),
    startExecution: (container: ServiceContainer, signal: AbortSignal, checkpoint?: () => void) =>
      initialize(container, signal, "execution", checkpoint),
  });
}

export type { ServiceGraph };
export { compileServiceGraph };
