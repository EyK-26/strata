import type { ServiceProvider } from "../contracts";
import {
  CORE_QUEUE_TOKEN,
  DEFAULT_QUEUE_DRIVER,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import { createAppQueue } from "../../core/queue/createAppQueue";

const queueProvider: ServiceProvider = {
  name: "core.queue",
  register({ container, config }) {
    const configuredDriver = process.env.QUEUE_DRIVER ?? DEFAULT_QUEUE_DRIVER;
    const driver =
      configuredDriver === "async" ||
      configuredDriver === "redis" ||
      configuredDriver === "sync"
        ? configuredDriver
        : DEFAULT_QUEUE_DRIVER;

    config.set("queue.driver", driver);
    container.set(
      CORE_QUEUE_TOKEN,
      createAppQueue(
        driver,
        config.get<string>(REDIS_URL_CONFIG_KEY) ?? process.env.REDIS_URL,
      ),
    );
  },
};

export default queueProvider;
