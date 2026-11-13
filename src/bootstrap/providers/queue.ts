import { createAuditExporter } from "@getstrata/core/audit/exportAuditLogs";
import {
  createAppQueue,
  createSystemQueueServices,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";
import { JobRegistry, QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { resolveQueueConfig, resolveQueueRuntimeConfig } from "@getstrata/core/queue/queueConfig";
import type { QueueHandoff } from "@getstrata/core/queue/queueHandoff";
import {
  CORE_CACHE_TOKEN,
  CORE_QUEUE_TOKEN,
  DEFAULT_QUEUE_DRIVER,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import type { ServiceProvider } from "../contracts";
import { discoverJobs } from "../discoverJobs";
import { registerDefaultJobs, SYSTEM_JOB_NAMES } from "../queue/defaultJobs";

function createQueueProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
  handoff?: QueueHandoff,
): ServiceProvider {
  const environment = Object.freeze({ ...env });
  const retryPolicy = resolveQueueConfig(environment);
  const runtime = resolveQueueRuntimeConfig(environment);
  return {
    name: "core.queue",
    async register({ container, config, onCleanup, invoke }) {
      const configuredDriver = environment.QUEUE_DRIVER ?? DEFAULT_QUEUE_DRIVER;
      const driver =
        configuredDriver === "async" || configuredDriver === "redis" || configuredDriver === "sync"
          ? configuredDriver
          : DEFAULT_QUEUE_DRIVER;

      config.set("queue.driver", driver);
      const failedJobs = createSystemQueueServices(
        invoke,
        {
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
        },
        handoff,
        SYSTEM_JOB_NAMES,
      );
      container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
      const registry = new JobRegistry();
      registerDefaultJobs(registry);
      await discoverJobs(registry);
      const queue = createAppQueue(
        driver,
        config.get<string>(REDIS_URL_CONFIG_KEY) ?? environment.REDIS_URL,
        failedJobs,
        registry,
        retryPolicy,
        runtime,
      );
      onCleanup(() => queue.close?.(), driver === "async" ? "drain" : "close");
      container.set(CORE_QUEUE_TOKEN, queue);
      container.set(QUEUE_JOB_REGISTRY_TOKEN, registry);
    },
  };
}

export { createQueueProvider };
