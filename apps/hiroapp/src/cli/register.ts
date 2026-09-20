import type { StrataCommandMap } from "@getstrata/cli";

const commands: StrataCommandMap = {
  "make:module": async () => (await import("@getstrata/cli/scaffold")).makeModuleCommand,
  "make:policy": async () => (await import("@getstrata/cli/scaffold")).makePolicyCommand,
  "make:job": async () => (await import("@getstrata/cli/scaffold")).makeJobCommand,
  "make:listener": async () => (await import("@getstrata/cli/scaffold")).makeListenerCommand,
  "make:request": async () => (await import("@getstrata/cli/scaffold")).makeRequestCommand,
  "make:factory": async () => (await import("@getstrata/cli/scaffold")).makeFactoryCommand,
  "make:migration": async () => (await import("@getstrata/cli/scaffold")).makeMigrationCommand,
  "queue:work": async () => (await import("./queueWork.ts")).queueWorkCommand,
  "queue:failed": async () => (await import("./queueFailed.ts")).queueFailedCommand,
  "queue:retry": async () => (await import("./queueFailed.ts")).queueRetryCommand,
  "queue:flush-failed": async () => (await import("./queueFailed.ts")).queueFlushFailedCommand,
  "openapi:generate": async () => (await import("./openapi.ts")).openapiGenerateCommand,
  "openapi:validate": async () => (await import("./openapi.ts")).openapiValidateCommand,
  "openapi:check": async () => (await import("./openapi.ts")).openapiCheckCommand,
  "schedule:run": async () => (await import("./scheduleRun.ts")).scheduleRunCommand,
};

export { commands };
