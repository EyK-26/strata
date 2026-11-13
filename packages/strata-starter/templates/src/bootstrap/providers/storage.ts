import type { ServiceProvider } from "@getstrata/core/contracts/di";
import type { StorageManager } from "@getstrata/core/storage/storage";

export function createStorageProvider(storage: StorageManager): ServiceProvider {
  return {
    name: "starter.storage",
    register({ dependencies }) {
      Reflect.set(dependencies, "storage", storage);
    },
  };
}
