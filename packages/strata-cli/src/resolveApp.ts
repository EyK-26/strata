import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { StrataAppConfig, StrataCommandMap, StrataFileConfig } from "./types.ts";

function firstExisting(root: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const absolutePath = join(root, candidate);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return undefined;
}

function resolvePath(
  root: string,
  value: string | undefined,
  fallbacks: string[],
): string | undefined {
  if (value) {
    return isAbsolute(value) ? value : join(root, value);
  }

  return firstExisting(root, fallbacks);
}

async function loadFileConfig(root: string): Promise<StrataFileConfig> {
  const configPath = firstExisting(root, ["strata.config.ts", "strata.config.js"]);
  if (!configPath) {
    return {};
  }

  const loaded = (await import(pathToFileURL(configPath).href)) as {
    default?: StrataFileConfig;
  } & StrataFileConfig;

  return loaded.default ?? loaded;
}

async function resolveApp(cwd = process.cwd()): Promise<StrataAppConfig> {
  const root = resolve(cwd);
  const file = await loadFileConfig(root);

  return {
    root,
    preload: resolvePath(root, file.preload, [
      "src/bootstrap/preload.ts",
      "src/bootstrap/preloadModules.ts",
    ]),
    server: resolvePath(root, file.server, ["src/bootstrap/server.ts"]),
    modulesDirectory: resolvePath(root, file.modulesDirectory, ["src/modules"]),
    commandsModule: resolvePath(root, file.commands, ["src/cli/register.ts"]),
    migrate: resolvePath(root, file.migrate, ["src/db/migrate.ts"]),
    fresh: resolvePath(root, file.fresh, ["src/db/fresh.ts"]),
  };
}

async function loadAppCommands(app: StrataAppConfig): Promise<StrataCommandMap> {
  if (!app.commandsModule) {
    return {};
  }

  const loaded = (await import(pathToFileURL(app.commandsModule).href)) as {
    commands?: StrataCommandMap;
    registerCommands?: () => StrataCommandMap | Promise<StrataCommandMap>;
  };

  if (typeof loaded.registerCommands === "function") {
    return await loaded.registerCommands();
  }

  return loaded.commands ?? {};
}

export { loadAppCommands, resolveApp };
