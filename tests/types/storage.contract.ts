import type { StorageDriver, StorageManager } from "@getstrata/core/storage/storage";

/** Compiled only: every storage implementation exposes the same idempotent delete result. */
export function storageContracts(driver: StorageDriver, storage: StorageManager): void {
  const driverResult: Promise<void> = driver.delete("missing");
  const managerResult: Promise<void> = storage.delete("missing");
  // @ts-expect-error Deletion does not report whether the object previously existed.
  const existence: Promise<boolean> = storage.delete("missing");
  void [driverResult, managerResult, existence];
}
