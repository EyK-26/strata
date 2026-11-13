import { createStorageDriver, resolveStorageConfig } from "@getstrata/core/storage/storage";
import type { ServiceProvider } from "../contracts";
import { legacyCacheProvider } from "../legacyCache";
import authProvider from "./auth";
import configProvider from "./config";
import policyProvider from "./policy";
import queueProvider from "./queue";
import { createStorageProvider } from "./storage";
import { createTracingProvider } from "./tracing";
import { viewProvider } from "./view";

function createCoreProviders(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceProvider[] {
  const storageProvider = createStorageProvider(createStorageDriver(resolveStorageConfig(env)));
  return [
    configProvider,
    createTracingProvider({ env }),
    legacyCacheProvider,
    storageProvider,
    authProvider,
    policyProvider,
    queueProvider,
    viewProvider,
  ];
}

export { createCoreProviders };
