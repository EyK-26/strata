import { registerInvalidateCacheOnModelWriteListeners } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import authProvider from "./auth.ts";
import cacheProvider from "./cache.ts";
import configProvider from "./config.ts";
import policyProvider from "./policy.ts";
import queueProvider from "./queue.ts";
import storageProvider from "./storage.ts";

const listenersProvider: ServiceProvider = {
  name: "starter.listeners",
  boot() {
    registerInvalidateCacheOnModelWriteListeners();
  },
};

const starterProviders: ServiceProvider[] = [
  configProvider,
  cacheProvider,
  storageProvider,
  queueProvider,
  authProvider,
  policyProvider,
  listenersProvider,
];

export { starterProviders };
