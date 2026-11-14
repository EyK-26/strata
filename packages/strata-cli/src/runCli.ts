import { pathToFileURL } from "node:url";
import { devCommand } from "./commands/dev.ts";
import { printHelp } from "./commands/help.ts";
import { migrateCommand, migrateFreshCommand } from "./commands/migrate.ts";
import { runCommand } from "./commands/run.ts";
import { startCommand } from "./commands/start.ts";
import { loadAppCommands, resolveApp } from "./resolveApp.ts";
import { scaffoldCommands } from "./scaffold/index.ts";
import type { RunCliOptions, StrataAppConfig, StrataCommandMap } from "./types.ts";

const HELP_FLAGS = new Set(["--help", "-h", "help"]);

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

  for (const [name, path, exported] of [
    ["migrate:status", app.migrateStatus, "status"],
    ["migrate:rollback", app.rollback, "rollback"],
  ] as const) {
    if (path)
      commands[name] =
        async () =>
        async (...args: string[]) => {
          if (args.length) throw new Error(`${name} takes no arguments.`);
          const entry = await import(pathToFileURL(path).href);
          if (typeof entry[exported] !== "function")
            throw new Error(`${path} must export ${exported}().`);
          try {
            await entry[exported]();
          } finally {
            if (typeof entry.close === "function") await entry.close();
          }
        };
  }

  return commands;
}

async function executeCli(options: RunCliOptions = {}): Promise<number> {
  const exitProcess = options.exitProcess ?? true;
  const app = await resolveApp(options.cwd ?? process.cwd());

  if (!options.skipBoot && app.preload) {
    await import(pathToFileURL(app.preload).href);
  }

  const appCommands = options.commands ?? (await loadAppCommands(app));
  const registry: StrataCommandMap = {
    ...builtinCommands(app),
    ...(app.application ? (await import("./applicationCommands")).applicationCommands(app) : {}),
    ...scaffoldCommands,
    ...appCommands,
  };

  const commandNames = [...new Set(["help", ...Object.keys(registry)])];
  registry.help = async () => async () => {
    printHelp(commandNames);
  };

  const argv = options.argv ?? process.argv.slice(2);
  const verbose = argv.includes("--verbose");
  const [requested = "help", ...args] = argv.filter((arg) => arg !== "--verbose");
  const command = HELP_FLAGS.has(requested) ? "help" : requested;
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
    console.error(verbose ? error : error instanceof Error ? error.message : String(error));
    return fail(1);
  }
}

async function runCli(options: RunCliOptions = {}): Promise<number> {
  try {
    return await executeCli(options);
  } catch (error) {
    const verbose = (options.argv ?? process.argv.slice(2)).includes("--verbose");
    console.error(verbose ? error : error instanceof Error ? error.message : String(error));
    if (options.exitProcess ?? true) process.exit(1);
    return 1;
  }
}

export { runCli };
