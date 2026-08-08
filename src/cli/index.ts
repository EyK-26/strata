import { helpCommand } from "./commands/help";
import { makeMigrationCommand } from "./commands/makeMigration";
import { makeModuleCommand } from "./commands/makeModule";
import { makeJobCommand } from "./commands/makeJob";
import { makeListenerCommand } from "./commands/makeListener";
import { makePolicyCommand } from "./commands/makePolicy";
import { migrateCommand } from "./commands/migrate";
import { migrateFreshCommand } from "./commands/migrateFresh";
import { migrateStatusCommand } from "./commands/migrateStatus";
import { queueWorkCommand } from "./commands/queueWork";
import { rollbackCommand } from "./commands/rollback";
import { seedCommand } from "./commands/seed";

const [command = "help", ...args] = process.argv.slice(2);

const commands: Record<
  string,
  (...commandArgs: string[]) => Promise<void> | void
> = {
  help: () => helpCommand(),
  migrate: () => migrateCommand(),
  "migrate:status": () => migrateStatusCommand(),
  "migrate:fresh": (...commandArgs: string[]) =>
    migrateFreshCommand(...commandArgs),
  rollback: () => rollbackCommand(),
  seed: () => seedCommand(),
  "make:migration": (name?: string) => makeMigrationCommand(name),
  "make:module": (name?: string) => makeModuleCommand(name),
  "make:policy": (moduleName?: string) => makePolicyCommand(moduleName),
  "make:job": (jobName?: string) => makeJobCommand(jobName),
  "make:listener": (...args: string[]) => makeListenerCommand(args[0], args[1]),
  "queue:work": () => queueWorkCommand(),
};

const handler = commands[command];

if (!handler) {
  console.error(`Unknown command: ${command}`);
  helpCommand();
  process.exit(1);
}

try {
  await handler(...args);
} catch (error) {
  console.error(error);
  process.exit(1);
}
