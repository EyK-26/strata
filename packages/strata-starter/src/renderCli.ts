import { authNeedsUsers, type StarterLayers } from "./types.ts";

function renderCliRegisterTs(layers?: StarterLayers): string {
  return `import type { StrataCommandMap } from "@getstrata/cli";

const commands: StrataCommandMap = {${layers && authNeedsUsers(layers.auth) ? '\n  "auth:provision-admin": async () => (await import("./initialAdmin.ts")).initialAdminCommand,' : ""}
  "make:module": async () => (await import("@getstrata/cli/scaffold")).makeModuleCommand,
  "make:model": async () => (await import("@getstrata/cli/scaffold")).makeModelCommand,
  "make:view": async () => (await import("@getstrata/cli/scaffold")).makeViewCommand,
  "make:policy": async () => (await import("@getstrata/cli/scaffold")).makePolicyCommand,
  "make:job": async () => (await import("@getstrata/cli/scaffold")).makeJobCommand,
  "make:listener": async () => (await import("@getstrata/cli/scaffold")).makeListenerCommand,
  "make:request": async () => (await import("@getstrata/cli/scaffold")).makeRequestCommand,
  "make:factory": async () => (await import("@getstrata/cli/scaffold")).makeFactoryCommand,
  "make:migration": async () => (await import("@getstrata/cli/scaffold")).makeMigrationCommand,
  "queue:work": async () => (await import("./queueWork.ts")).queueWorkCommand,
  "outbox:work": async () => (await import("./outboxWork.ts")).outboxWorkCommand,
  "queue:failed": async () => (await import("./queueFailed.ts")).queueFailedCommand,
  "queue:retry": async () => (await import("./queueFailed.ts")).queueRetryCommand,
  "queue:flush-failed": async () => (await import("./queueFailed.ts")).queueFlushFailedCommand,
  "openapi:generate": async () => (await import("./openapi.ts")).openapiGenerateCommand,
  "openapi:validate": async () => (await import("./openapi.ts")).openapiValidateCommand,
  "openapi:check": async () => (await import("./openapi.ts")).openapiCheckCommand,
  "schedule:run": async () => (await import("./scheduleRun.ts")).scheduleRunCommand,
};

export { commands };
`;
}

function renderCliQueueWorkTs(): string {
  return `import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { bootstrapApp } from "../bootstrap/createApp.ts";
async function queueWorkCommand():Promise<void> {
  await runQueueWorkerCommand({boot:()=>bootstrapApp({migrate:false,mode:"worker"})});
}
export {queueWorkCommand};
`;
}

function renderCliOutboxWorkTs(): string {
  return `async function outboxWorkCommand(): Promise<void> {
  const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  await runOutboxWorkerCommand({
    boot: () => bootstrapApp({ migrate: false, mode: "outbox-worker" }),
  });
}

export { outboxWorkCommand };
`;
}

function renderCliQueueFailedTs(): string {
  return `import { createQueueFailedCommands } from "@getstrata/cli/queueFailed";
import { bootstrapApp } from "../bootstrap/createApp.ts";
const {queueFailedCommand,queueFlushFailedCommand,queueRetryCommand}=createQueueFailedCommands(
  ()=>bootstrapApp({migrate:false,mode:"command"}),
);
export {queueFailedCommand,queueFlushFailedCommand,queueRetryCommand};
`;
}

function renderCliOpenApiTs(): string {
  return `import { createApp } from "../bootstrap/createApp.ts";
import { createOpenApiGenerateCommand, createOpenApiValidateCommand, createOpenApiCheckCommand } from "@getstrata/cli/openapi";
type CommandFactory=typeof createOpenApiGenerateCommand;
async function execute(factory:CommandFactory):Promise<void> {
  let app:Awaited<ReturnType<typeof createApp>>|undefined;
  await factory(async()=>{app=await createApp({migrate:false,mode:"command"});return app;},async()=>{await app?.context.dispose();})();
}
async function openapiGenerateCommand(){await execute(createOpenApiGenerateCommand);}
async function openapiValidateCommand(){await execute(createOpenApiValidateCommand);}
async function openapiCheckCommand(){await execute(createOpenApiCheckCommand);}
export {openapiGenerateCommand,openapiValidateCommand,openapiCheckCommand};
`;
}

function renderCliScheduleRunTs(): string {
  return `import { createScheduleRunCommand } from "@getstrata/cli/schedule";
import { createScheduleRunOptions } from "@getstrata/bootstrap/schedule";
import { bootstrapApp } from "../bootstrap/createApp.ts";
async function scheduleRunCommand():Promise<void> {
  const environment=Object.freeze({...process.env});
  let app:Awaited<ReturnType<typeof bootstrapApp>>|undefined;
  await createScheduleRunCommand(async()=>{
    app=await bootstrapApp({migrate:false,mode:"command"});const {createSchedule}=await import("../bootstrap/schedule.ts");return createSchedule(app,environment);
  },async()=>{await app?.context.dispose();},{scheduler:createScheduleRunOptions(environment)})();
}
export {scheduleRunCommand};
`;
}

export {
  renderCliOpenApiTs,
  renderCliOutboxWorkTs,
  renderCliQueueFailedTs,
  renderCliQueueWorkTs,
  renderCliRegisterTs,
  renderCliScheduleRunTs,
};
