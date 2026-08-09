import { describe, expect, test } from "bun:test";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { CACHE_TAGS } from "../../src/core/cache/tags";

describe("CacheRepository", () => {
  test("remember stores and returns cached values", async () => {
    const repository = new CacheRepository(new SimpleCacheStore(new SimpleCache(1_000, 10)));
    let calls = 0;

    const first = await repository.remember("users:1", async () => {
      calls += 1;
      return { id: 1 };
    });
    const second = await repository.remember("users:1", async () => {
      calls += 1;
      return { id: 2 };
    });

    expect(first).toEqual({ id: 1 });
    expect(second).toEqual({ id: 1 });
    expect(calls).toBe(1);
  });

  test("forget removes a single cache entry", async () => {
    const repository = new CacheRepository(new SimpleCacheStore(new SimpleCache(1_000, 10)));

    await repository.remember("users:1", async () => 1);
    expect(await repository.forget("users:1")).toBe(true);
    expect(await repository.get<number>("users:1")).toBeUndefined();
  });

  test("tags flush only entries in the selected tag groups", async () => {
    const repository = new CacheRepository(new SimpleCacheStore(new SimpleCache(1_000, 10)));

    await repository
      .tags(CACHE_TAGS.organizations)
      .remember("organizations?page=1", async () => [{ id: 1 }]);
    await repository.tags(CACHE_TAGS.projects).remember("projects?page=1", async () => [{ id: 2 }]);
    await repository
      .tags(CACHE_TAGS.organizations, CACHE_TAGS.reports)
      .remember("reports/summary", async () => ({ total: 3 }));

    expect(await repository.size()).toBe(3);

    const removed = await repository.tags(CACHE_TAGS.organizations).flush();

    expect(removed).toBe(2);
    expect(await repository.get("organizations?page=1")).toBeUndefined();
    expect(await repository.get("reports/summary")).toBeUndefined();
    expect(await repository.get<Array<{ id: number }>>("projects?page=1")).toEqual([{ id: 2 }]);
  });

  test("exposes alias helpers for store operations", async () => {
    const repository = new CacheRepository(new SimpleCacheStore(new SimpleCache(1_000, 10)));

    await repository.getOrSet("widgets:1", async () => ({ id: 1 }));
    expect(await repository.get<{ id: number }>("widgets:1")).toEqual({ id: 1 });

    expect(await repository.invalidate("widgets:1")).toBe(true);
    expect(await repository.get("widgets:1")).toBeUndefined();

    await repository.getOrSet("widgets:prefix", async () => 1);
    await repository.getOrSet("widgets:prefix?page=2", async () => 2);
    expect(await repository.invalidateByPrefix("widgets:prefix")).toBe(2);

    await repository.getOrSet("widgets:remaining", async () => 3);
    await repository.clear();
    expect(await repository.size()).toBe(0);
  });
});
