import { expect, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import { buildWebModuleRoutes } from "@getstrata/bootstrap/buildWebModuleRoutes";
import { CORE_AUTH_TOKEN, CORE_HTTP_CLEANUP_TOKEN } from "@getstrata/bootstrap/config";
import {
  type AppDependencies,
  type AppModule,
  ServiceContainer,
} from "@getstrata/bootstrap/contracts";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { LocalStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { restoreEnvVar } from "../helpers/restoreEnv";

async function withModuleServer(
  mode: "api" | "web",
  routes: NonNullable<AppModule["routes"]>,
  verify: (url: URL, cache: CacheRepository) => Promise<void>,
): Promise<void> {
  const tenancy = process.env.TENANCY_DRIVER;
  const etag = process.env.FEATURE_ETAG;
  process.env.TENANCY_DRIVER = "none";
  process.env.FEATURE_ETAG = "true";
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache()));
  const cleanups: Array<() => void | Promise<void>> = [];
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_HTTP_CLEANUP_TOKEN, (cleanup) => cleanups.push(cleanup));
  const dependencies: AppDependencies = {
    container,
    cache,
    storage: new StorageManager(new LocalStorageDriver()),
  };
  const module: AppModule = {
    name: "cached-json-contract",
    ...(mode === "api" ? { routes } : { webRoutes: routes }),
  };
  let stopServer: (() => Promise<void>) | undefined;
  try {
    const built =
      mode === "api"
        ? buildModuleRoutes(dependencies, { modules: [module] })
        : buildWebModuleRoutes(dependencies, { modules: [module] });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      routes: built,
      fetch: () => new Response("missing", { status: 404 }),
    });
    stopServer = async () => {
      await server.stop(true);
    };
    await verify(server.url, cache);
  } finally {
    await stopServer?.();
    for (const cleanup of cleanups.reverse()) await cleanup();
    await cache.flush();
    await cache.close();
    restoreEnvVar("TENANCY_DRIVER", tenancy);
    restoreEnvVar("FEATURE_ETAG", etag);
  }
}

// Use both real route builders, their middleware, the real memory cache store
// and a listening Bun server. No database, Redis, mocked kernel or cache adapter.
for (const mode of ["api", "web"] as const) {
  for (const tagged of [false, true]) {
    test(`${mode} module cachedJson serves, validates and invalidates ${tagged ? "tagged" : "untagged"} JSON over HTTP`, async () => {
      let loads = 0;
      const routes: NonNullable<AppModule["routes"]> = ({ cachedJson }) => ({
        "/cached": {
          GET: (request: Request) =>
            cachedJson(
              "module-json",
              async () => ({ loads: ++loads }),
              tagged ? ["reports"] : [],
              request,
            ),
        },
        "/without-request": {
          GET: () => cachedJson("without-request", async () => false),
        },
      });
      await withModuleServer(mode, routes, async (url, cache) => {
        const first = await fetch(new URL("/cached", url));
        expect(first.status).toBe(200);
        expect(loads).toBe(1);
        expect(first.headers.get("content-type")).toContain("application/json");
        expect(await first.json()).toEqual({ loads: 1 });
        expect(first.headers.get("cache-control")).toBe("private, must-revalidate");
        expect(first.headers.get("vary")).toContain("Authorization");
        expect(first.headers.get("vary")).toContain("X-Tenant-Id");
        expect(first.headers.get("x-request-id")).toBeTruthy();
        const version = first.headers.get("etag");
        expect(version).toBeTruthy();
        if (version === null) throw new Error("cachedJson did not supply its ETag");

        const unchanged = await fetch(new URL("/cached", url), {
          headers: { "if-none-match": version },
        });
        expect(unchanged.status).toBe(304);
        expect(await unchanged.text()).toBe("");
        expect(unchanged.headers.get("etag")).toBe(version);
        expect(loads).toBe(1);

        if (tagged) expect(await cache.tags("reports").flush()).toBe(1);
        else expect(await cache.forget("module-json")).toBe(true);
        const changed = await fetch(new URL("/cached", url), {
          headers: { "if-none-match": version },
        });
        expect(changed.status).toBe(200);
        expect(await changed.json()).toEqual({ loads: 2 });
        expect(changed.headers.get("etag")).not.toBe(version);
        expect(loads).toBe(2);

        const noRequest = await fetch(new URL("/without-request", url));
        expect(noRequest.status).toBe(200);
        expect(await noRequest.json()).toBe(false);
        expect(noRequest.headers.get("etag")).toBeNull();
      });
    });
  }

  test(`${mode} module cachedJson propagates loader failure without caching it`, async () => {
    let loads = 0;
    const routes: NonNullable<AppModule["routes"]> = ({ cachedJson }) => ({
      "/failure": {
        GET: (request: Request) =>
          cachedJson(
            "failure",
            async () => {
              if (++loads === 1) throw new Error("expected cache loader failure");
              return { loads };
            },
            [],
            request,
          ),
      },
    });
    await withModuleServer(mode, routes, async (url, cache) => {
      const failed = await fetch(new URL("/failure", url));
      expect(failed.status).toBe(500);
      await failed.text();
      expect(loads).toBe(1);
      expect(await cache.get("failure")).toBeUndefined();
      const recovered = await fetch(new URL("/failure", url));
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toEqual({ loads: 2 });
      expect(loads).toBe(2);
    });
  });
}
