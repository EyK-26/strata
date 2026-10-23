import { expect, test } from "bun:test";
import { createCacheStore } from "@getstrata/core/cache/createCacheStore";
import { CacheRepository } from "@getstrata/core/cache/repository";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
for (const invalidation of ["forget", "clear", "prefix", "tag"] as const) {
  test(`${invalidation} fences an older local fill`, async () => {
    const cache = new CacheRepository(
      createCacheStore({ driver: "array", ttlMs: 60_000, maxEntries: 100 }),
    );
    const started = deferred<void>(),
      result = deferred<number>();
    const scope = invalidation === "tag" ? cache.tags("inventory") : cache;
    const pending = scope.remember("inventory/41", async () => {
      started.resolve();
      return result.promise;
    });
    await started.promise;
    if (invalidation === "forget") await cache.forget("inventory/41");
    else if (invalidation === "clear") await cache.clear();
    else if (invalidation === "prefix") await cache.invalidateByPrefix("inventory/41");
    else await cache.tags("inventory").flush();
    result.resolve(10);
    expect(await pending).toBe(10);
    let reads = 0;
    expect(
      await scope.remember("inventory/41", async () => {
        reads++;
        return 9;
      }),
    ).toBe(9);
    expect(reads).toBe(1);
    await cache.close();
  });
}

test("retired completion cannot replace a newer fill or remove its coalescing owner", async () => {
  const cache = new CacheRepository(
    createCacheStore({ driver: "array", ttlMs: 60_000, maxEntries: 100 }),
  );
  const old = deferred<number>(),
    fresh = deferred<number>();
  const first = cache.remember("item", async () => old.promise);
  await cache.forget("item");
  const second = cache.remember("item", async () => fresh.promise);
  old.resolve(1);
  expect(await first).toBe(1);
  let duplicate = 0;
  const third = cache.remember("item", async () => {
    duplicate++;
    return 3;
  });
  fresh.resolve(2);
  expect(await second).toBe(2);
  expect(await third).toBe(2);
  expect(duplicate).toBe(0);
  expect(await cache.get("item")).toBe(2);
});
