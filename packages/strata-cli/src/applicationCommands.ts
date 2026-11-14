import { pathToFileURL } from "node:url";
import type { QueueCommandApplication } from "./queueFailed";

interface CommandApp extends QueueCommandApplication {
  readonly outboxWorker: import("@getstrata/core/events/outbox").OutboxWorkerTransport;
  readonly routes: Record<string, unknown>;
  readonly context: { dispose(): Promise<void> };
}
type AppFactory = (options: {
  migrate: false;
  mode: "command" | "worker" | "outbox-worker";
}) => Promise<CommandApp>;

import { createScheduleRunOptions } from "@getstrata/bootstrap/schedule";
import {
  createOpenApiCheckCommand,
  createOpenApiGenerateCommand,
  createOpenApiValidateCommand,
} from "./openapi";
import { runOutboxWorkerCommand } from "./outboxWorker";
import { createQueueFailedCommands } from "./queueFailed";
import { runQueueWorkerCommand } from "./queueWorker";
import { createScheduleRunCommand } from "./schedule";
import type { StrataAppConfig, StrataCommandMap } from "./types";

function applicationCommands(config: StrataAppConfig): StrataCommandMap {
  const applicationPath = config.application;
  if (!applicationPath) return {};
  const load = async () =>
    (await import(pathToFileURL(applicationPath).href)) as {
      bootstrapApp: AppFactory;
      createApp: AppFactory;
    };
  const boot = async () => (await load()).bootstrapApp({ migrate: false, mode: "command" });
  const failed = createQueueFailedCommands(boot);
  const commands: StrataCommandMap = {
    "queue:work": async () => () =>
      runQueueWorkerCommand({
        boot: async () => (await load()).bootstrapApp({ migrate: false, mode: "worker" }),
      }),
    "outbox:work": async () => () =>
      runOutboxWorkerCommand({
        boot: async () => (await load()).bootstrapApp({ migrate: false, mode: "outbox-worker" }),
      }),
    "queue:failed": async () => failed.queueFailedCommand,
    "queue:retry": async () => failed.queueRetryCommand,
    "queue:flush-failed": async () => failed.queueFlushFailedCommand,
  };
  for (const [name, factory] of Object.entries({
    generate: createOpenApiGenerateCommand,
    validate: createOpenApiValidateCommand,
    check: createOpenApiCheckCommand,
  })) {
    commands[`openapi:${name}`] = async () => async () => {
      let app: Awaited<ReturnType<AppFactory>> | undefined;
      await factory(
        async () => {
          app = await (await load()).createApp({ migrate: false, mode: "command" });
          return app;
        },
        async () => {
          await app?.context.dispose();
        },
      )();
    };
  }
  const schedulePath = config.schedule;
  if (schedulePath)
    commands["schedule:run"] = async () => async () => {
      const environment = Object.freeze({ ...process.env });
      let app: Awaited<ReturnType<AppFactory>> | undefined;
      await createScheduleRunCommand(
        async () => {
          app = await boot();
          const { createSchedule } = await import(pathToFileURL(schedulePath).href);
          return createSchedule(app, environment);
        },
        async () => {
          await app?.context.dispose();
        },
        { scheduler: createScheduleRunOptions(environment) },
      )();
    };
  return commands;
}

export { applicationCommands };
