import { CORE_QUEUE_TOKEN } from "@getstrata/bootstrap/config";
import { createAppContext, type InitializedAppContext } from "@getstrata/bootstrap/context";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import type { QueueCommandApplication } from "@getstrata/cli/queueFailed";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { Queue } from "@getstrata/core/queue";
import { FAILED_JOB_SERVICE_TOKEN, type QueueServices } from "@getstrata/core/queue/createAppQueue";
import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import { createQueueWorkerTransport } from "@getstrata/core/queue/queueWorkerTransport";

/** Process entrypoint snapshot; pool ownership belongs to this one application. */
async function bootQueueApplication(
  withWorker = false,
): Promise<QueueCommandApplication & { context: InitializedAppContext }> {
  assertProductionSecrets();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Queue commands require DATABASE_URL.");
  const configuredDriver =
    process.env.DB_CONNECTION ??
    (url.startsWith("sqlite:") ? "sqlite" : url.startsWith("mysql:") ? "mysql" : "pgsql");
  const driver =
    configuredDriver === "postgresql"
      ? "pgsql"
      : configuredDriver === "mariadb"
        ? "mysql"
        : configuredDriver;
  if (!["sqlite", "mysql", "pgsql", "postgres"].includes(driver))
    throw new Error("Unsupported queue database driver.");
  if (driver === "sqlite" && !url.startsWith("sqlite:"))
    throw new Error("SQLite queue commands require a sqlite: DATABASE_URL.");
  const connection = "primary";
  const options =
    driver === "pgsql" || driver === "postgres"
      ? { driver: "pgsql" as const, url: url }
      : driver === "mysql"
        ? { driver: "mysql" as const, url: url }
        : {
            driver: "sqlite" as const,
            filename: url.slice("sqlite:".length).replace(/^\/\//, ""),
          };
  let context: InitializedAppContext;
  const redisUrl = process.env.REDIS_URL;
  if (withWorker && !redisUrl) throw new Error("queue:work requires REDIS_URL to be set.");
  const selectedServices = () => context.container.get<QueueServices>(FAILED_JOB_SERVICE_TOKEN);
  const workerServices: Pick<QueueServices, "recordFailure" | "runAttempt"> = {
    recordFailure: (input) => selectedServices().recordFailure(input),
    runAttempt: (...args) => selectedServices().runAttempt(...args),
  };
  const worker = withWorker
    ? createQueueWorkerTransport({
        redisUrl: redisUrl as string,
        queueServices: workerServices,
      })
    : undefined;
  context = await createAppContext(undefined, {
    connection,
    definition: {
      providers: [],
      transports: worker ? [worker.transport] : [],
      services: createDatabaseBindings({
        default: connection,
        connections: { [connection]: options },
        repositories: [failedJobRepository],
      }),
    },
  });
  return {
    context,
    application: context.application,
    ...(worker ? { worker } : {}),
    invoke: context.invoke,
    queueServices: context.container.get<QueueServices>(FAILED_JOB_SERVICE_TOKEN),
    queue: context.container.get<Queue>(CORE_QUEUE_TOKEN),
  };
}

export { bootQueueApplication };
