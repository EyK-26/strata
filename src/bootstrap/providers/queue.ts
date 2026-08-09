import {
  createAppQueue,
  createFailedJobService,
  FAILED_JOB_SERVICE_TOKEN,
} from "@getstrata/core/queue/createAppQueue";
import { CORE_QUEUE_TOKEN, DEFAULT_QUEUE_DRIVER, REDIS_URL_CONFIG_KEY } from "../config";
import type { ServiceProvider } from "../contracts";
import { registerDefaultJobs } from "../queue/defaultJobs";

const queueProvider: ServiceProvider = {
  name: "core.queue",
  register({ container, config }) {
    const configuredDriver = process.env.QUEUE_DRIVER ?? DEFAULT_QUEUE_DRIVER;
    const driver =
      configuredDriver === "async" || configuredDriver === "redis" || configuredDriver === "sync"
        ? configuredDriver
        : DEFAULT_QUEUE_DRIVER;

    config.set("queue.driver", driver);
    const failedJobs = createFailedJobService();
    container.set(FAILED_JOB_SERVICE_TOKEN, failedJobs);
    container.set(
      CORE_QUEUE_TOKEN,
      createAppQueue(
        driver,
        config.get<string>(REDIS_URL_CONFIG_KEY) ?? process.env.REDIS_URL,
        failedJobs,
        registerDefaultJobs,
      ),
    );
  },
};

export default queueProvider;
