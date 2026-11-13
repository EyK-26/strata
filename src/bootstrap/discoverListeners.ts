import { join } from "node:path";
import type { ServiceDeclaration } from "@getstrata/core/contracts/services";
import type { RepositoryEffectsDeclaration } from "@getstrata/core/database/definitions";
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
