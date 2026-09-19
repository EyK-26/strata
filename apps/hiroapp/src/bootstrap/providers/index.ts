import { discoverListeners } from "@getstrata/bootstrap/discoverListeners";
import { registerInvalidateCacheOnModelWriteListeners } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import authProvider from "./auth.ts";
import cacheProvider from "./cache.ts";
import configProvider from "./config.ts";
import policyProvider from "./policy.ts";
import queueProvider from "./queue.ts";
import storageProvider from "./storage.ts";

const registeredListenerGroups = new Set<string>();

function registerListenerGroup(name: string, register: () => void): void {
  if (registeredListenerGroups.has(name)) {
    return;
  }

  registeredListenerGroups.add(name);
  register();
}

const listenersProvider: ServiceProvider = {
  name: "starter.listeners",
  boot() {
    registerListenerGroup("cache.invalidate-on-model-write", () => {
      registerInvalidateCacheOnModelWriteListeners();
    });

    for (const registerListener of discoverListeners()) {
      registerListener();
    }
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
