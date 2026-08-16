import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppModule } from "./contracts";

async function loadDiscoveredModules(): Promise<AppModule[]> {
  const modulesDirectory = join(import.meta.dir, "../modules");

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

let appModules: AppModule[] = [];
let modulesReady: Promise<AppModule[]> | undefined;

async function ensureModulesLoaded(): Promise<AppModule[]> {
  if (appModules.length > 0) {
    return appModules;
  }

  modulesReady ??= loadDiscoveredModules().then((modules) => {
    appModules = modules;
    return modules;
  });

  return modulesReady;
}

function discoverModules(): AppModule[] {
  return appModules;
}

export { appModules, discoverModules, ensureModulesLoaded };
