import { createAuditExporter } from "@getstrata/core/audit/exportAuditLogs";
import {
  createAppQueue,
  createSystemQueueServices,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";
import {
  CORE_CACHE_TOKEN,
  CORE_QUEUE_TOKEN,
  DEFAULT_QUEUE_DRIVER,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import type { ServiceProvider } from "../contracts";
import { discoverJobs } from "../discoverJobs";
import { registerDefaultJobs } from "../queue/defaultJobs";

const queueProvider: ServiceProvider = {
  name: "core.queue",
  async register({ container, config, onCleanup, invoke }) {
    const environment = Object.freeze({ ...process.env });
    const configuredDriver = environment.QUEUE_DRIVER ?? DEFAULT_QUEUE_DRIVER;
    const driver =
      configuredDriver === "async" || configuredDriver === "redis" || configuredDriver === "sync"
        ? configuredDriver
        : DEFAULT_QUEUE_DRIVER;

    config.set("queue.driver", driver);
    const failedJobs = createSystemQueueServices(invoke, {
      cache: container.resolve(CORE_CACHE_TOKEN),
      auditExport: createAuditExporter({
        environment,
        runSql: (work) =>
          invoke(
            { kind: "command", actor: { kind: "system", policy: "audit.export" } },
            ({ database, policy }) =>
              environment.TENANCY_DRIVER === "rls"
                ? policy.run(database, { kind: "bypass" }, work)
                : database.transaction(work),
          ),
      }),
    });
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    registerDefaultJobs();
    await discoverJobs();
    const queue = createAppQueue(
      driver,
      config.get<string>(REDIS_URL_CONFIG_KEY) ?? environment.REDIS_URL,
      failedJobs,
    );
    onCleanup(() => queue.close?.(), driver === "async" ? "drain" : "close");
    container.set(CORE_QUEUE_TOKEN, queue);
  },
};

export default queueProvider;
