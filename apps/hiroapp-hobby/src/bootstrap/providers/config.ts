import {
  APP_PORT_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  CORE_PUBLIC_TENANCY_TOKEN,
  DATABASE_URL_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { normalizeTenantHostname } from "@getstrata/core/tenant/tenantMiddleware";
import { loadConfig } from "../config.ts";

const configProvider: ServiceProvider = {
  name: "starter.config",
  register({ container, config }) {
    const appConfig = loadConfig();

    container.set(CORE_CONFIG_TOKEN, config);
    // One approved origin for the starter tenant. Multi-tenant apps replace this lookup.
    if (isProductionEnv()) {
      const publicHost = normalizeTenantHostname(new URL(appConfig.appUrl).host);
      container.set(CORE_PUBLIC_TENANCY_TOKEN, {
        resolveTenantId: async (hostname) => (hostname === publicHost ? 1 : null),
      });
    }
    config.set(DATABASE_URL_CONFIG_KEY, appConfig.databaseUrl);
    config.set(APP_PORT_CONFIG_KEY, appConfig.port);
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    config.set("app.url", appConfig.appUrl);
    config.set("cache.driver", process.env.CACHE_DRIVER ?? "array");
    config.set("cache.ttlMs", 3_600_000);
    config.set("cache.maxEntries", 100);
    config.set("queue.driver", process.env.QUEUE_DRIVER ?? "sync");
  },
};

export default configProvider;
