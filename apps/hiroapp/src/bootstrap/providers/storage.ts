import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";

const storageProvider: ServiceProvider = {
  name: "hiroapp.storage",
  register({ dependencies }) {
    dependencies.storage = new StorageManager(createStorageDriver());
  },
};

export { storageProvider };
