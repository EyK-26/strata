import { helpCommand } from "./commands/help";
import { makeFactoryCommand } from "./commands/makeFactory";
import { makeMigrationCommand } from "./commands/makeMigration";
import { makeModuleCommand } from "./commands/makeModule";
import { makeJobCommand } from "./commands/makeJob";
import { makeListenerCommand } from "./commands/makeListener";
import { makePolicyCommand } from "./commands/makePolicy";
import { makeRequestCommand } from "./commands/makeRequest";
import { migrateCommand } from "./commands/migrate";
import { migrateFreshCommand } from "./commands/migrateFresh";
import { migrateStatusCommand } from "./commands/migrateStatus";
import {
  queueFailedCommand,
  queueFlushFailedCommand,
  queueRetryCommand,
} from "./commands/queueFailed";
import { queueWorkCommand } from "./commands/queueWork";
import { rollbackCommand } from "./commands/rollback";
import { routeListCommand } from "./commands/routeList";
import { openapiGenerateCommand } from "./commands/openapiGenerate";
import { sdkGenerateCommand } from "./commands/sdkGenerate";
import { scheduleRunCommand } from "./commands/scheduleRun";
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
  "make:listener": (...commandArgs: string[]) =>
    makeListenerCommand(commandArgs[0], commandArgs[1]),
  "make:request": (moduleName?: string) => makeRequestCommand(moduleName),
  "make:factory": (name?: string) => makeFactoryCommand(name),
  "queue:work": () => queueWorkCommand(),
  "queue:failed": () => queueFailedCommand(),
  "queue:retry": (id?: string) => queueRetryCommand(id),
  "queue:flush-failed": () => queueFlushFailedCommand(),
  "route:list": () => routeListCommand(),
  "openapi:generate": () => openapiGenerateCommand(),
  "sdk:generate": () => sdkGenerateCommand(),
  "schedule:run": () => scheduleRunCommand(),
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
