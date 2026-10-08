import { join, resolve } from "node:path";
import {
  type InfrastructureDiscoveryOptions,
  importInfrastructure,
  infrastructureFiles,
} from "./infrastructureDiscovery";

type ListenerRegistrar = () => void | Promise<void>;
interface DiscoverListenersOptions extends InfrastructureDiscoveryOptions {
  manifest?: readonly ListenerRegistrar[];
}
interface DiscoverListenersState {
  loads: Map<string | readonly ListenerRegistrar[], Promise<ListenerRegistrar[]>>;
}
const KEY = Symbol.for("@getstrata/discoverListenersState");
function state(): DiscoverListenersState {
  const globals = globalThis as Record<symbol, DiscoverListenersState | undefined>;
  globals[KEY] ??= { loads: new Map() };
  return globals[KEY];
}
async function load(options: DiscoverListenersOptions): Promise<ListenerRegistrar[]> {
  const listeners = new Set<ListenerRegistrar>();
  const add = (value: unknown, location: string) => {
    if (typeof value !== "function")
      throw new TypeError(
        `Invalid listener registrar at ${location}: expected a default function.`,
      );
    listeners.add(value as ListenerRegistrar);
  };
  if (options.manifest)
    for (const [index, value] of options.manifest.entries())
      add(value, `listener manifest[${index}]`);
  else
    for (const file of await infrastructureFiles(
      options.directory ?? join(process.cwd(), "src", "listeners"),
      options.exclude,
    )) {
      const exports = await importInfrastructure(file);
      const value = exports.default;
      add(value && typeof value === "object" && "default" in value ? value.default : value, file);
    }
  return [...listeners];
}
function discoverListeners(options: DiscoverListenersOptions = {}): Promise<ListenerRegistrar[]> {
  const cache = state().loads;
  const key =
    options.manifest ??
    JSON.stringify([
      resolve(options.directory ?? join(process.cwd(), "src", "listeners")),
      [...(options.exclude ?? [])].sort(),
    ]);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load(options).catch((error) => {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}
function resetDiscoverListenersForTests(): void {
  state().loads = new Map();
}

export type { DiscoverListenersOptions, ListenerRegistrar };
export { discoverListeners, resetDiscoverListenersForTests };
