import { pathToFileURL } from "node:url";
import { devCommand } from "./commands/dev.ts";
import { printHelp } from "./commands/help.ts";
import { migrateCommand, migrateFreshCommand } from "./commands/migrate.ts";
import { runCommand } from "./commands/run.ts";
import { startCommand } from "./commands/start.ts";
import { loadAppCommands, resolveApp } from "./resolveApp.ts";
import type { RunCliOptions, StrataAppConfig, StrataCommandMap } from "./types.ts";

function builtinCommands(app: StrataAppConfig): StrataCommandMap {
  const commands: StrataCommandMap = {
    dev: async () => async () => {
      await devCommand(app);
    },
    start: async () => async () => {
      await startCommand(app);
    },
    run:
      async () =>
      async (...args: string[]) => {
        await runCommand(app, args);
      },
  };

  if (app.migrate) {
    commands.migrate =
      async () =>
      async (...args: string[]) => {
        await migrateCommand(app, args);
      };
  }

  if (app.fresh) {
    commands["migrate:fresh"] =
      async () =>
      async (...args: string[]) => {
        await migrateFreshCommand(app, args);
      };
  }

  return commands;
}

async function runCli(options: RunCliOptions = {}): Promise<number> {
  const exitProcess = options.exitProcess ?? true;
  const app = await resolveApp(options.cwd ?? process.cwd());

  if (!options.skipBoot && app.preload) {
    await import(pathToFileURL(app.preload).href);
  }

  const appCommands = options.commands ?? (await loadAppCommands(app));
  const registry: StrataCommandMap = {
    ...builtinCommands(app),
    ...appCommands,
  };

  const commandNames = [...new Set(["help", ...Object.keys(registry)])];
  registry.help = async () => async () => {
    printHelp(commandNames);
  };

  const [command = "help", ...args] = options.argv ?? process.argv.slice(2);
  const loadHandler = registry[command];

  const fail = (code: number): number => {
    if (exitProcess) {
      process.exit(code);
    }
    return code;
  };

  if (!loadHandler) {
    console.error(`Unknown command: ${command}`);
    printHelp(commandNames);
    return fail(1);
  }

  try {
    const handler = await loadHandler();
    await handler(...args);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    console.error(error);
    return fail(1);
  }
}

export { runCli };
