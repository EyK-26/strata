import type { StrataCommandMap } from "@getstrata/cli";

const commands: StrataCommandMap = {
  help: async () => (await import("./commands/help.ts")).helpCommand,
  new: async () => (await import("./commands/new.ts")).newCommand,
  migrate: async () => (await import("./commands/migrate.ts")).migrateCommand,
  "migrate:status": async () => (await import("./commands/migrateStatus.ts")).migrateStatusCommand,
  "migrate:fresh": async () => (await import("./commands/migrateFresh.ts")).migrateFreshCommand,
  rollback: async () => (await import("./commands/rollback.ts")).rollbackCommand,
  seed: async () => (await import("./commands/seed.ts")).seedCommand,
  "make:migration": async () => (await import("./commands/makeMigration.ts")).makeMigrationCommand,
  "make:module": async () => (await import("./commands/makeModule.ts")).makeModuleCommand,
  "make:policy": async () => (await import("./commands/makePolicy.ts")).makePolicyCommand,
  "make:job": async () => (await import("./commands/makeJob.ts")).makeJobCommand,
  "make:listener": async () => (await import("./commands/makeListener.ts")).makeListenerCommand,
  "make:request": async () => (await import("./commands/makeRequest.ts")).makeRequestCommand,
  "make:factory": async () => (await import("./commands/makeFactory.ts")).makeFactoryCommand,
  "queue:work": async () => (await import("./commands/queueWork.ts")).queueWorkCommand,
  "queue:failed": async () => (await import("./commands/queueFailed.ts")).queueFailedCommand,
  "queue:retry": async () => (await import("./commands/queueFailed.ts")).queueRetryCommand,
  "queue:flush-failed": async () =>
    (await import("./commands/queueFailed.ts")).queueFlushFailedCommand,
  "route:list": async () => (await import("./commands/routeList.ts")).routeListCommand,
  "openapi:generate": async () =>
    (await import("./commands/openapiGenerate.ts")).openapiGenerateCommand,
  "openapi:validate": async () =>
    (await import("./commands/openapiValidate.ts")).openapiValidateCommand,
  "openapi:check": async () => (await import("./commands/openapiCheck.ts")).openapiCheckCommand,
  "sdk:generate": async () => (await import("./commands/sdkGenerate.ts")).sdkGenerateCommand,
  "schedule:run": async () => (await import("./commands/scheduleRun.ts")).scheduleRunCommand,
  "schedule:install": async () =>
    (await import("./commands/scheduleInstall.ts")).scheduleInstallCommand,
  "schedule:uninstall": async () =>
    (await import("./commands/scheduleUninstall.ts")).scheduleUninstallCommand,
  shell: async () => (await import("./commands/shell.ts")).shellCommand,
  "secrets:check": async () => (await import("./commands/secretsCheck.ts")).secretsCheckCommand,
  tinker: async () => (await import("./commands/tinker.ts")).tinkerCommand,
};

export { commands };
