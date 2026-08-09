import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";

const storageProvider: ServiceProvider = {
  name: "starter.storage",
  register({ dependencies }) {
    Reflect.set(dependencies, "storage", new StorageManager(createStorageDriver()));
  },
};

export default storageProvider;
