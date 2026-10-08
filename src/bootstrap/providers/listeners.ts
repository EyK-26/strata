import type { ServiceProvider } from "../contracts";
import { discoverListeners } from "../discoverListeners";
import { registerInvalidateCacheOnModelWriteListeners } from "../listeners/invalidateCacheOnModelWrite";

const listenersProvider: ServiceProvider = {
  name: "core.listeners",
  async boot({ onCleanup }) {
    onCleanup(registerInvalidateCacheOnModelWriteListeners());

    for (const registerListener of await discoverListeners()) {
      await registerListener();
    }
  },
};

export default listenersProvider;
