import { authNeedsUsers, type StarterLayers } from "./types.ts";

function renderCliRegisterTs(layers?: StarterLayers): string {
  return `import type { StrataCommandMap } from "@getstrata/cli";

const commands: StrataCommandMap = {${layers && authNeedsUsers(layers.auth) ? '\n  "auth:provision-admin": async () => (await import("./initialAdmin.ts")).initialAdminCommand,' : ""}
  "make:module": async () => (await import("@getstrata/cli/scaffold")).makeModuleCommand,
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
  return `async function queueWorkCommand(): Promise<void> {
  if (!process.env.REDIS_URL) {
    throw new Error("queue:work requires REDIS_URL to be set.");
  }

  const { runQueueWorkerCommand } = await import("@getstrata/cli/queueWorker");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");

  let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
  await runQueueWorkerCommand({
    boot: async () => {
      app = await bootstrapApp({ migrate: false });
    },
    drain: () => app?.context.drain(),
    flush: () => app?.context.flush(),
    close: async () => {
      try {
        await app?.context.dispose();
      } finally {
        await closeDatabase();
      }
    },
  });
}

export { queueWorkCommand };
`;
}

function renderCliOutboxWorkTs(): string {
  return `async function outboxWorkCommand(): Promise<void> {
  const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
  const { listeners } = await import("../outbox/registry.ts");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");

  let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
  await runOutboxWorkerCommand({
    listeners,
    boot: async () => {
      app = await bootstrapApp({ migrate: false });
    },
    drain: () => app?.context.drain(),
    flush: () => app?.context.flush(),
    close: async () => {
      try {
        await app?.context.dispose();
      } finally {
        await closeDatabase();
      }
    },
  });
}

export { outboxWorkCommand };
`;
}

function renderCliQueueFailedTs(): string {
  return `import { createQueueFailedCommands } from "@getstrata/cli/queueFailed";
import { bootstrapApp } from "../bootstrap/createApp.ts";
import { closeDatabase } from "../bootstrap/database.ts";

let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
const { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand } = createQueueFailedCommands(
  async () => { app = await bootstrapApp({ migrate: false }); },
  async () => { try { await app?.context.dispose(); } finally { app = undefined; await closeDatabase(); } },
);

export { queueFailedCommand, queueFlushFailedCommand, queueRetryCommand };
`;
}

function renderCliOpenApiTs(): string {
  return `import { createApp } from "../bootstrap/createApp.ts";
import { closeDatabase } from "../bootstrap/database.ts";

let app: Awaited<ReturnType<typeof createApp>> | undefined;
async function bootstrap() {
  app = await createApp({ migrate: false });
  return app;
}
async function close() {
  try { await app?.context.dispose(); } finally { app = undefined; await closeDatabase(); }
}

async function openapiGenerateCommand(): Promise<void> {
  const { createOpenApiGenerateCommand } = await import("@getstrata/cli/openapi");
  await createOpenApiGenerateCommand(bootstrap, close)();
}

async function openapiValidateCommand(): Promise<void> {
  const { createOpenApiValidateCommand } = await import("@getstrata/cli/openapi");
  await createOpenApiValidateCommand(bootstrap, close)();
}

async function openapiCheckCommand(): Promise<void> {
  const { createOpenApiCheckCommand } = await import("@getstrata/cli/openapi");
  await createOpenApiCheckCommand(bootstrap, close)();
}

export { openapiCheckCommand, openapiGenerateCommand, openapiValidateCommand };
`;
}

function renderCliScheduleRunTs(): string {
  return `async function scheduleRunCommand(): Promise<void> {
  const { createScheduleRunCommand } = await import("@getstrata/cli/schedule");
  const { bootstrapApp } = await import("../bootstrap/createApp.ts");
  const { closeDatabase } = await import("../bootstrap/database.ts");
  let app: Awaited<ReturnType<typeof bootstrapApp>> | undefined;
  await createScheduleRunCommand(async () => {
    app = await bootstrapApp({ migrate: false });
    await import("../bootstrap/schedule.ts");
  }, async () => {
    try { await app?.context.dispose(); } finally { await closeDatabase(); }
  }, { drain: () => app?.context.drain(), flush: () => app?.context.flush() })();
}

export { scheduleRunCommand };
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
