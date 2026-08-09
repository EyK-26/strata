import {
  APP_PORT_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { loadConfig } from "../config.ts";

const configProvider: ServiceProvider = {
  name: "starter.config",
  register({ container, config }) {
    const appConfig = loadConfig();

    container.set(CORE_CONFIG_TOKEN, config);
    config.set(DATABASE_URL_CONFIG_KEY, appConfig.databaseUrl);
    config.set(APP_PORT_CONFIG_KEY, appConfig.port);
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    config.set("app.url", appConfig.appUrl);
    config.set("cache.driver", "array");
    config.set("cache.ttlMs", 3_600_000);
    config.set("cache.maxEntries", 100);
    config.set("queue.driver", process.env.QUEUE_DRIVER ?? "sync");
  },
};

export default configProvider;
