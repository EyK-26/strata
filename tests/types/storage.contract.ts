import type { Storage, StorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { requireStreamingStorage } from "@getstrata/core/storage/storage";

/** Compiled only: every storage implementation exposes the same idempotent delete result. */
export function storageContracts(driver: StorageDriver, storage: StorageManager): void {
  const driverResult: Promise<void> = driver.delete("missing");
  const managerResult: Promise<void> = storage.delete("missing");
  // @ts-expect-error Deletion does not report whether the object previously existed.
  const existence: Promise<boolean> = storage.delete("missing");
  void [driverResult, managerResult, existence];
}

/** A handwritten adapter can satisfy application dependencies without manager internals. */
export function consumerStorageContract(storage: Storage): void {
  const adapter: Storage = {
    async get() {
      return null;
    },
    async put(path) {
      return path;
    },
    async delete() {},
  };
  const streaming = requireStreamingStorage(storage);
  const read: Promise<ReadableStream<Uint8Array> | null> = streaming.readStream("object");
  const write: Promise<string> = streaming.writeStream("object", new Blob(["contents"]));
  void [adapter, read, write];
}
