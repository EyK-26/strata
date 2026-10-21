import assert from "node:assert/strict";
import { createAppContext } from "@getstrata/bootstrap/context";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { LocalStorageDriver, StorageManager } from "@getstrata/core/storage/storage";

const dependencies: ServiceProvider = {
  name: "qualification.memory-dependencies",
  register({ dependencies, onCleanup }) {
    const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache()));
    dependencies.cache = cache;
    dependencies.storage = new StorageManager(new LocalStorageDriver());
    onCleanup(() => cache.close());
  },
};

for (const phase of ["drain", "flush"] as const) {
  const order: string[] = [];
  let admissionError: unknown;
  const context = await createAppContext([
    dependencies,
    {
      name: "qualification.phase-admission",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push(phase);
          try {
            onCleanup(() => {
              order.push("stranded");
            }, phase);
          } catch (error) {
            admissionError = error;
          }
          if (phase === "drain") {
            onCleanup(() => {
              order.push("later-flush");
            }, "flush");
            onCleanup(() => {
              order.push("close");
            });
          }
        }, phase);
      },
    },
  ]);
  try {
    await context[phase]();
    assert.deepEqual(order, [phase]);
    assert.ok(admissionError instanceof Error, `${phase} admitted stranded cleanup work`);
    assert.equal(admissionError.message, "Cannot register cleanup after its phase started.");
    await context[phase]();
    assert.deepEqual(order, [phase]);
    await context.dispose();
    assert.deepEqual(order, phase === "drain" ? ["drain", "later-flush", "close"] : ["flush"]);
  } finally {
    await context.dispose();
  }
}

console.log("PASS installed provider phase admission, idempotence and later-phase registration");
