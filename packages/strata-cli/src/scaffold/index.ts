import type { StrataCommandMap } from "../types.ts";

const scaffoldCommands: StrataCommandMap = {
  "make:migration": async () => (await import("./makeMigration.ts")).makeMigrationCommand,
  "make:module": async () => (await import("./makeModule.ts")).makeModuleCommand,
  "make:policy": async () => (await import("./makePolicy.ts")).makePolicyCommand,
  "make:job": async () => (await import("./makeJob.ts")).makeJobCommand,
  "make:listener": async () => (await import("./makeListener.ts")).makeListenerCommand,
  "make:request": async () => (await import("./makeRequest.ts")).makeRequestCommand,
  "make:factory": async () => (await import("./makeFactory.ts")).makeFactoryCommand,
  "queue:failed": async () => (await import("./queueFailed.ts")).queueFailedCommand,
  "queue:retry": async () => (await import("./queueFailed.ts")).queueRetryCommand,
  "queue:flush-failed": async () => (await import("./queueFailed.ts")).queueFlushFailedCommand,
};

export { scaffoldCommands };
