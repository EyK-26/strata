import type { ProviderDefinition, ProviderScope } from "./application";
import type { ServiceDeclaration } from "./services";

interface ApplicationProviderOptions {
  readonly name: string;
  readonly requires?: readonly string[];
  readonly services?: readonly ServiceDeclaration[];
  readonly setup?: (scope: ProviderScope) => void | Promise<void>;
  readonly boot?: (scope: ProviderScope) => void | Promise<void>;
}

/** Group declarative bindings and startup hooks without introducing a mutable container. */
function defineProvider(options: ApplicationProviderOptions): ProviderDefinition {
  const { name, requires, services, setup, boot } = options;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("Provider names must be nonempty strings.");
  }
  if (
    requires !== undefined &&
    (!Array.isArray(requires) ||
      requires.some((name) => typeof name !== "string" || name.trim().length === 0))
  ) {
    throw new TypeError("Provider dependencies must be an array of nonempty names.");
  }
  if (services !== undefined && !Array.isArray(services)) {
    throw new TypeError("Provider services must be an array.");
  }
  if (
    (setup !== undefined && typeof setup !== "function") ||
    (boot !== undefined && typeof boot !== "function")
  ) {
    throw new TypeError("Provider hooks must be functions.");
  }
  return Object.freeze({
    name,
    requires: Object.freeze([...(requires ?? [])]),
    services: Object.freeze([...(services ?? [])]),
    setup: setup ?? (() => {}),
    ...(boot ? { boot } : {}),
  });
}

export type { ApplicationProviderOptions };
export { defineProvider };
