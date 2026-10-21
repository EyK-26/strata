import { expect, test } from "bun:test";
import { createAppContext } from "@getstrata/bootstrap/context";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { LocalStorageDriver, StorageManager } from "@getstrata/core/storage/storage";

const inMemoryDependencies: ServiceProvider = {
  name: "phase-test.dependencies",
  register({ dependencies, onCleanup }) {
    const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache()));
    dependencies.cache = cache;
    dependencies.storage = new StorageManager(new LocalStorageDriver());
    onCleanup(() => cache.close());
  },
};

for (const phase of ["drain", "flush"] as const) {
  test(`${phase} rejects registering more work from its first running handler`, async () => {
    let admissionError: unknown;
    let lateCalls = 0;
    const context = await createAppContext([
      inMemoryDependencies,
      {
        name: "phase-test.registration",
        register({ onCleanup }) {
          onCleanup(() => {
            try {
              onCleanup(() => {
                lateCalls++;
              }, phase);
            } catch (error) {
              admissionError = error;
            }
          }, phase);
        },
      },
    ]);
    try {
      await context[phase]();
      expect(lateCalls).toBe(0);
      expect(admissionError).toBeInstanceOf(Error);
      expect((admissionError as Error).message).toBe(
        "Cannot register cleanup after its phase started.",
      );
      await context[phase]();
      expect(lateCalls).toBe(0);
    } finally {
      await context.dispose();
    }
  });
}

test("an explicit drain can still acquire cleanup work for phases that have not started", async () => {
  const order: string[] = [];
  const context = await createAppContext([
    inMemoryDependencies,
    {
      name: "phase-test.cross-phase",
      register({ onCleanup }) {
        onCleanup(() => {
          order.push("drain");
          onCleanup(() => {
            order.push("flush");
          }, "flush");
          onCleanup(() => {
            order.push("close");
          });
        }, "drain");
      },
    },
  ]);
  try {
    await context.drain();
    expect(order).toEqual(["drain"]);
    await context.dispose();
    expect(order).toEqual(["drain", "flush", "close"]);
  } finally {
    await context.dispose();
  }
});
