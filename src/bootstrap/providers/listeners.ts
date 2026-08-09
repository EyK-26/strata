import type { ServiceProvider } from "../contracts";
import { discoverListeners } from "../discoverListeners";
import { registerInvalidateCacheOnModelWriteListeners } from "../listeners/invalidateCacheOnModelWrite";

const registeredListenerGroups = new Set<string>();

function registerListenerGroup(name: string, register: () => void): void {
  if (registeredListenerGroups.has(name)) {
    return;
  }

  registeredListenerGroups.add(name);
  register();
}

const listenersProvider: ServiceProvider = {
  name: "core.listeners",
  boot() {
    registerListenerGroup("cache.invalidate-on-model-write", () => {
      registerInvalidateCacheOnModelWriteListeners();
    });

    for (const registerListener of discoverListeners()) {
      registerListener();
    }
  },
};

export default listenersProvider;
