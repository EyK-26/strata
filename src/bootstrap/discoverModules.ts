import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AppModule } from "./contracts";
import { importInfrastructure } from "./infrastructureDiscovery";

interface DiscoverModulesOptions {
  modulesDir?: string;
  exclude?: readonly string[];
  manifest?: readonly AppModule[];
}
function validateModule(value: unknown, location: string): asserts value is AppModule {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`Invalid application module at ${location}.`);
  const module = value as Record<string, unknown>;
  if (typeof module.name !== "string" || !module.name.trim())
    throw new TypeError(`Invalid module name at ${location}.`);
  if (
    module.order !== undefined &&
    (typeof module.order !== "number" || !Number.isFinite(module.order))
  )
    throw new TypeError(`Invalid module order at ${location}.`);
  for (const hook of ["routes", "webRoutes"])
    if (module[hook] !== undefined && typeof module[hook] !== "function")
      throw new TypeError(`Invalid ${hook} at ${location}.`);
  if (module.providers !== undefined) {
    if (!Array.isArray(module.providers)) throw new TypeError(`Invalid providers at ${location}.`);
    for (const provider of module.providers) {
      if (
        !provider ||
        typeof provider.name !== "string" ||
        !provider.name.trim() ||
        (provider.register !== undefined && typeof provider.register !== "function") ||
        (provider.boot !== undefined && typeof provider.boot !== "function")
      )
        throw new TypeError(`Invalid provider at ${location}.`);
    }
  }
}
async function load(options: DiscoverModulesOptions): Promise<readonly AppModule[]> {
  const manifest = options.manifest;
  const entries: Array<{ value: unknown; location: string }> = [];
  if (manifest)
    for (const [index, value] of manifest.entries())
      entries.push({ value, location: `module manifest[${index}]` });
  else {
    const directory = options.modulesDir;
    if (!directory)
      throw new Error("An explicit modulesDir or manifest is required to discover modules.");
    let folders: Dirent[];
    try {
      folders = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
      throw error;
    }
    const excluded = new Set(options.exclude ?? []);
    for (const folder of folders
      .filter((entry) => entry.isDirectory() && !excluded.has(entry.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = join(directory, folder.name);
      const files = await readdir(path);
      const candidates = files.filter((file) => /^index\.(ts|js|mts|mjs)$/.test(file));
      if (candidates.length !== 1)
        throw new Error(`Expected one module entrypoint at ${path}; found ${candidates.length}.`);
      const file = join(path, candidates[0] as string);
      const exports = await importInfrastructure(file);
      entries.push({ value: exports.default, location: file });
    }
  }
  const names = new Map<string, string>();
  const modules: AppModule[] = [];
  for (const { value, location } of entries) {
    validateModule(value, location);
    const previous = names.get(value.name);
    if (previous)
      throw new Error(
        `Duplicate module "${value.name}" at ${location}; first declared at ${previous}.`,
      );
    names.set(value.name, location);
    modules.push(value);
  }
  // Stable source order resolves equal priorities without locale-dependent ordering.
  return Object.freeze(modules.sort((left, right) => (left.order ?? 100) - (right.order ?? 100)));
}
/** A discovery owner captures its source and owns its pending result, including retries. */
function createModuleDiscovery(options: DiscoverModulesOptions) {
  const source: DiscoverModulesOptions = Object.freeze({
    ...options,
    modulesDir: options.modulesDir === undefined ? undefined : resolve(options.modulesDir),
    manifest: options.manifest === undefined ? undefined : Object.freeze([...options.manifest]),
    exclude: options.exclude === undefined ? undefined : Object.freeze([...options.exclude]),
  });
  let pending: Promise<readonly AppModule[]> | undefined;
  return Object.freeze({
    load(): Promise<readonly AppModule[]> {
      if (pending) return pending;
      const result = load(source).catch((error) => {
        if (pending === result) pending = undefined;
        throw error;
      });
      pending = result;
      return result;
    },
  });
}

/** One-shot discovery; applications retain the returned immutable module list. */
function ensureModulesLoaded(options: DiscoverModulesOptions): Promise<readonly AppModule[]> {
  return createModuleDiscovery(options).load();
}

export type { DiscoverModulesOptions };
export { createModuleDiscovery, ensureModulesLoaded };
