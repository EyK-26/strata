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
interface DiscoverModulesState {
  configuredModulesDir?: string;
  configuredManifest?: readonly AppModule[];
  appModules: AppModule[];
  modulesReady?: Promise<AppModule[]>;
  source?: string | readonly AppModule[];
}
const KEY = Symbol.for("@getstrata/discoverModulesState");
function state(): DiscoverModulesState {
  const globals = globalThis as Record<symbol, DiscoverModulesState | undefined>;
  globals[KEY] ??= { appModules: [] };
  return globals[KEY];
}
function configureModulesDirectory(modulesDir: string): void {
  const current = state();
  const directory = resolve(modulesDir);
  if (current.configuredModulesDir !== directory || current.configuredManifest) {
    current.appModules.length = 0;
    current.modulesReady = undefined;
    current.source = undefined;
  }
  current.configuredManifest = undefined;
  current.configuredModulesDir = directory;
}
function configureModulesManifest(manifest: readonly AppModule[]): void {
  const current = state();
  if (current.configuredManifest !== manifest) {
    current.appModules.length = 0;
    current.modulesReady = undefined;
    current.source = undefined;
  }
  current.configuredManifest = manifest;
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
async function load(options: DiscoverModulesOptions): Promise<AppModule[]> {
  const manifest =
    options.manifest ?? (options.modulesDir === undefined ? state().configuredManifest : undefined);
  const entries: Array<{ value: unknown; location: string }> = [];
  if (manifest)
    for (const [index, value] of manifest.entries())
      entries.push({ value, location: `module manifest[${index}]` });
  else {
    const directory = options.modulesDir ?? state().configuredModulesDir;
    if (!directory)
      throw new Error(
        "configureModulesDirectory() or configureModulesManifest() must be called before discovering modules.",
      );
    let folders: Dirent[];
    try {
      folders = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
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
  return modules.sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
}
function ensureModulesLoaded(options: DiscoverModulesOptions = {}): Promise<AppModule[]> {
  const current = state();
  const key =
    options.manifest ??
    (options.modulesDir === undefined ? current.configuredManifest : undefined) ??
    JSON.stringify([
      options.modulesDir ? resolve(options.modulesDir) : current.configuredModulesDir,
      [...(options.exclude ?? [])].sort(),
    ]);
  if (current.modulesReady && current.source === key) return current.modulesReady;
  current.appModules.length = 0;
  current.source = key;
  const pending = load(options)
    .then((modules) => {
      if (current.modulesReady !== pending) return modules;
      current.appModules.splice(0, current.appModules.length, ...modules);
      return current.appModules;
    })
    .catch((error) => {
      if (current.modulesReady === pending) current.modulesReady = undefined;
      throw error;
    });
  current.modulesReady = pending;
  return pending;
}
function discoverModules(): AppModule[] {
  return state().appModules;
}
function resetDiscoverModulesForTests(): void {
  const current = state();
  current.configuredModulesDir = undefined;
  current.configuredManifest = undefined;
  current.appModules.length = 0;
  current.modulesReady = undefined;
  current.source = undefined;
}

export type { DiscoverModulesOptions };
export {
  configureModulesDirectory,
  configureModulesManifest,
  discoverModules,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
};
