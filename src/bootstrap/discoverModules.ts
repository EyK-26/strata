import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppModule } from "./contracts";

async function loadDiscoveredModules(): Promise<AppModule[]> {
  const modulesDirectory = join(import.meta.dir, "../modules");
  const moduleNames = readdirSync(modulesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const modules = await Promise.all(
    moduleNames.map(async (moduleName) => {
      const moduleUrl = pathToFileURL(
        join(modulesDirectory, moduleName, "index.ts"),
      ).href;
      const loaded = (await import(moduleUrl)) as { default: AppModule };
      return loaded.default;
    }),
  );

  return modules
    .filter((module): module is AppModule => module?.name !== undefined)
    .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
}

const appModules = await loadDiscoveredModules();

function discoverModules(): AppModule[] {
  return appModules;
}

export { appModules, discoverModules };
