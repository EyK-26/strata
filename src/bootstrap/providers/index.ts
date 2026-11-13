import { createStorageDriver, resolveStorageConfig } from "@getstrata/core/storage/storage";
import type { ServiceProvider } from "../contracts";
import authProvider from "./auth";
import { createCacheProvider } from "./cacheProvider";
import { createConfigProvider } from "./config";
import policyProvider from "./policy";
import { createQueueProvider } from "./queue";
import { createStorageProvider } from "./storage";
import { createTracingProvider } from "./tracing";
import { createViewProvider } from "./view";

function createCoreProviders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceProvider[] {
  env = Object.freeze({ ...env });
  const configProvider = createConfigProvider(env);
  const cacheProvider = createCacheProvider(env);
  const storageProvider = createStorageProvider(createStorageDriver(resolveStorageConfig(env)));
  return [
    configProvider,
    createTracingProvider({ env }),
    cacheProvider,
    storageProvider,
    authProvider,
    policyProvider,
    createQueueProvider(env),
    createViewProvider({ env }),
  ];
}

export { createCoreProviders };
