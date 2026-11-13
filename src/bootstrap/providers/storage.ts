import { type FactoryServiceDeclaration, service } from "@getstrata/core/contracts/services";
import {
  CORE_STORAGE_TOKEN,
  createStorageDriver,
  type StorageConfig,
  type StorageDriver,
  StorageManager,
  snapshotStorageConfig,
} from "@getstrata/core/storage/storage";
import type { ServiceProvider } from "../contracts";

type StorageBindingOptions =
  | StorageConfig
  | { readonly driver: "custom"; readonly storage: StorageDriver };

/** Capture validated settings before application resources can open. */
function createStorageBindings(
  config: StorageBindingOptions,
): readonly FactoryServiceDeclaration[] {
  let create: () => StorageDriver;
  if (config.driver === "custom") {
    const driver = config.storage;
    assertStorageDriver(driver);
    create = () => driver;
  } else {
    const snapshot = snapshotStorageConfig(config);
    create = () => createStorageDriver(snapshot);
  }
  return Object.freeze([
    service(CORE_STORAGE_TOKEN, {
      lifetime: "application",
      dependencies: [] as const,
      create: () => new StorageManager(create()),
    }),
  ]);
}

/** Custom capabilities remain explicit and never initialize unused local/S3 configuration. */
function assertStorageDriver(driver: StorageDriver): void {
  if (
    !driver ||
    [driver.put, driver.get, driver.delete].some((method) => typeof method !== "function")
  )
    throw new TypeError("Storage requires put, get, and delete capabilities.");
}
function createStorageProvider(driver: StorageDriver): ServiceProvider {
  assertStorageDriver(driver);
  return Object.freeze({
    name: "core.storage",
    register({ dependencies }: Parameters<NonNullable<ServiceProvider["register"]>>[0]) {
      dependencies.storage = new StorageManager(driver);
    },
  });
}

export type { StorageBindingOptions };
export { CORE_STORAGE_TOKEN, createStorageBindings, createStorageProvider };
