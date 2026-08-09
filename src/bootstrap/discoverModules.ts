import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppModule } from "./contracts";

interface DiscoverModulesOptions {
  modulesDir?: string;
}

const DISCOVER_MODULES_STATE_KEY = Symbol.for("@getstrata/discoverModulesState");

interface DiscoverModulesState {
  configuredModulesDir?: string;
  appModules: AppModule[];
  modulesReady?: Promise<AppModule[]>;
}

function readDiscoverModulesState(): DiscoverModulesState {
  const existing = (globalThis as Record<symbol, DiscoverModulesState | undefined>)[
    DISCOVER_MODULES_STATE_KEY
  ];

  if (existing) {
    return existing;
  }

  const state: DiscoverModulesState = { appModules: [] };
  (globalThis as Record<symbol, DiscoverModulesState>)[DISCOVER_MODULES_STATE_KEY] = state;
  return state;
}

function configureModulesDirectory(modulesDir: string): void {
  const state = readDiscoverModulesState();

  if (state.configuredModulesDir !== modulesDir) {
    state.appModules.length = 0;
    state.modulesReady = undefined;
  }

  state.configuredModulesDir = modulesDir;
}

function resolveModulesDirectory(options?: DiscoverModulesOptions): string {
  const state = readDiscoverModulesState();

  if (options?.modulesDir) {
    return options.modulesDir;
  }

  if (state.configuredModulesDir) {
    return state.configuredModulesDir;
  }

  throw new Error(
    "configureModulesDirectory() must be called before discovering modules. The app preload (or starter) should call it.",
  );
}

async function loadDiscoveredModules(options?: DiscoverModulesOptions): Promise<AppModule[]> {
  const modulesDirectory = resolveModulesDirectory(options);

  let moduleNames: string[];
  try {
    moduleNames = readdirSync(modulesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const modules = await Promise.all(
    moduleNames.map(async (moduleName) => {
      const moduleUrl = pathToFileURL(join(modulesDirectory, moduleName, "index.ts")).href;
      const loaded = (await import(moduleUrl)) as { default: AppModule };
      return loaded.default;
    }),
  );

  return modules
    .filter((module): module is AppModule => module?.name !== undefined)
    .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
}

async function ensureModulesLoaded(options?: DiscoverModulesOptions): Promise<AppModule[]> {
  const state = readDiscoverModulesState();

  if (state.appModules.length > 0) {
    return state.appModules;
  }

  state.modulesReady ??= loadDiscoveredModules(options).then((modules) => {
    state.appModules.splice(0, state.appModules.length, ...modules);
    return state.appModules;
  });

  return state.modulesReady;
}

function discoverModules(): AppModule[] {
  return readDiscoverModulesState().appModules;
}

function resetDiscoverModulesForTests(): void {
  const state = readDiscoverModulesState();
  state.configuredModulesDir = undefined;
  state.appModules.length = 0;
  state.modulesReady = undefined;
}

export type { DiscoverModulesOptions };
export {
  configureModulesDirectory,
  discoverModules,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
};
