import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import type { ServiceProvider } from "../contracts";

const storageProvider: ServiceProvider = {
  name: "core.storage",
  register({ dependencies }) {
    dependencies.storage = new StorageManager(createStorageDriver());
  },
};

export default storageProvider;
