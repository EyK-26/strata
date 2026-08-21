import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
} from "@getstrata/bootstrap/discoverModules";

configureModulesDirectory(join(import.meta.dir, "../modules"));
await ensureModulesLoaded();

const commandLoaders: Record<string, () => Promise<(...args: string[]) => Promise<void> | void>> = {
  help: async () => (await import("../cli/commands/help.ts")).helpCommand,
  new: async () => (await import("../cli/commands/new.ts")).newCommand,
  migrate: async () => (await import("../cli/commands/migrate.ts")).migrateCommand,
  "migrate:status": async () =>
    (await import("../cli/commands/migrateStatus.ts")).migrateStatusCommand,
  "migrate:fresh": async () =>
    (await import("../cli/commands/migrateFresh.ts")).migrateFreshCommand,
  rollback: async () => (await import("../cli/commands/rollback.ts")).rollbackCommand,
  seed: async () => (await import("../cli/commands/seed.ts")).seedCommand,
  "make:migration": async () =>
    (await import("../cli/commands/makeMigration.ts")).makeMigrationCommand,
  "make:module": async () => (await import("../cli/commands/makeModule.ts")).makeModuleCommand,
  "make:policy": async () => (await import("../cli/commands/makePolicy.ts")).makePolicyCommand,
  "make:job": async () => (await import("../cli/commands/makeJob.ts")).makeJobCommand,
  "make:listener": async () =>
    (await import("../cli/commands/makeListener.ts")).makeListenerCommand,
  "make:request": async () => (await import("../cli/commands/makeRequest.ts")).makeRequestCommand,
  "make:factory": async () => (await import("../cli/commands/makeFactory.ts")).makeFactoryCommand,
  "queue:work": async () => (await import("../cli/commands/queueWork.ts")).queueWorkCommand,
  "queue:failed": async () => (await import("../cli/commands/queueFailed.ts")).queueFailedCommand,
  "queue:retry": async () => (await import("../cli/commands/queueFailed.ts")).queueRetryCommand,
  "queue:flush-failed": async () =>
    (await import("../cli/commands/queueFailed.ts")).queueFlushFailedCommand,
  "route:list": async () => (await import("../cli/commands/routeList.ts")).routeListCommand,
  "openapi:generate": async () =>
    (await import("../cli/commands/openapiGenerate.ts")).openapiGenerateCommand,
  "openapi:validate": async () =>
    (await import("../cli/commands/openapiValidate.ts")).openapiValidateCommand,
  "openapi:check": async () =>
    (await import("../cli/commands/openapiCheck.ts")).openapiCheckCommand,
  "sdk:generate": async () => (await import("../cli/commands/sdkGenerate.ts")).sdkGenerateCommand,
  "schedule:run": async () => (await import("../cli/commands/scheduleRun.ts")).scheduleRunCommand,
  "schedule:install": async () =>
    (await import("../cli/commands/scheduleInstall.ts")).scheduleInstallCommand,
  "schedule:uninstall": async () =>
    (await import("../cli/commands/scheduleUninstall.ts")).scheduleUninstallCommand,
  shell: async () => (await import("../cli/commands/shell.ts")).shellCommand,
  "secrets:check": async () =>
    (await import("../cli/commands/secretsCheck.ts")).secretsCheckCommand,
  tinker: async () => (await import("../cli/commands/tinker.ts")).tinkerCommand,
};

const [command = "help", ...args] = process.argv.slice(2);
const loadHandler = commandLoaders[command];

if (!loadHandler) {
  const { helpCommand } = await import("../cli/commands/help.ts");
  console.error(`Unknown command: ${command}`);
  helpCommand();
  process.exit(1);
}

try {
  const handler = await loadHandler();
  await handler(...args);
} catch (error) {
  console.error(error);
  process.exit(1);
}
