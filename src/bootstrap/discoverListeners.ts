import { join } from "node:path";
import { APPLICATION_EVENT_BUS_TOKEN } from "@getstrata/bootstrap/providers/events";
import type { ServiceDeclaration } from "@getstrata/core/contracts/services";
import { resourceService, service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import type { RepositoryEffectsDeclaration } from "@getstrata/core/database/definitions";
import { repositoryEffects } from "@getstrata/core/database/definitions";
import {
  type InfrastructureDiscoveryOptions,
  importInfrastructure,
  infrastructureFiles,
} from "./infrastructureDiscovery";

/** Inert graph declarations, collected before application construction and pool effects. */
export interface ListenerDeclarations {
  readonly services: readonly ServiceDeclaration[];
  readonly repositoryEffects: readonly RepositoryEffectsDeclaration[];
}
export interface DiscoverListenersOptions extends InfrastructureDiscoveryOptions {
  readonly manifest?: readonly ListenerDeclarations[];
}
function snapshot(value: unknown, location: string): ListenerDeclarations {
  if (!value || typeof value !== "object")
    throw new TypeError(`Invalid listener declarations at ${location}.`);
  const fields = Object.getOwnPropertyDescriptors(value);
  const services = fields.services?.value,
    effects = fields.repositoryEffects?.value;
  if (
    !fields.services ||
    !("value" in fields.services) ||
    !Array.isArray(services) ||
    !fields.repositoryEffects ||
    !("value" in fields.repositoryEffects) ||
    !Array.isArray(effects)
  )
    throw new TypeError(
      `Listener ${location} must export services and repositoryEffects declarations; registrar callbacks are no longer supported.`,
    );
  return Object.freeze({
    services: Object.freeze([...services]),
    repositoryEffects: Object.freeze([...effects]),
  });
}
export async function discoverListeners(
  options: DiscoverListenersOptions = {},
): Promise<readonly ListenerDeclarations[]> {
  const result: ListenerDeclarations[] = [];
  const seen = new Set<object>();
  const add = (input: unknown, location: string) => {
    const value =
      input && typeof input === "object" && Object.getOwnPropertyDescriptor(input, "default")?.value
        ? Object.getOwnPropertyDescriptor(input, "default")?.value
        : input;
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
    }
    result.push(snapshot(value, location));
  };
  if (options.manifest)
    for (const [index, value] of options.manifest.entries()) add(value, `manifest[${index}]`);
  else
    for (const file of await infrastructureFiles(
      options.directory ?? join(process.cwd(), "src", "listeners"),
      options.exclude,
    )) {
      const exports = await importInfrastructure(file);
      add(exports.default, file);
    }
  return Object.freeze(result);
}

/** Declare an after-commit listener; its lifetime belongs to the application graph. */
export function defineModelListener<
  R extends object,
  K extends keyof R & string,
  T extends import("@getstrata/core/database/baseRepository").BaseRepository<R, K>,
>(
  repository: import("@getstrata/core/database/definitions").RepositoryDefinition<R, K, T>,
  action: import("@getstrata/core/database/definitions").RepositoryAction,
  handler: import("@getstrata/core/database/definitions").AfterCommitRepositoryListener<R>,
): ListenerDeclarations {
  const token = createServiceToken<typeof handler>(`${repository.name}.${action}.listener`);
  return Object.freeze({
    services: Object.freeze([
      service(token, { lifetime: "application", dependencies: [] as const, create: () => handler }),
    ]),
    repositoryEffects: Object.freeze([
      repositoryEffects(repository, [{ action, afterCommit: token }]),
    ]),
  });
}

/** Subscribe when the application opens and unsubscribe when it stops. */
export function defineEventListener(
  event: string,
  handler: Parameters<import("@getstrata/core/events").EventBus["listen"]>[1],
): ListenerDeclarations {
  const token = createServiceToken<() => void>(`${event}.listener`);
  return Object.freeze({
    repositoryEffects: Object.freeze([]),
    services: Object.freeze([
      resourceService(token, {
        lifetime: "application",
        dependencies: [APPLICATION_EVENT_BUS_TOKEN] as const,
        create: (bus) => ({
          name: event,
          open: () => ({ ok: true, value: bus.listen(event, handler) }),
          close: (unsubscribe) => unsubscribe(),
        }),
      }),
    ]),
  });
}
