import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import {
  type AppDependencies,
  type AppRouteMap,
  ServiceContainer,
} from "@getstrata/bootstrap/contracts";
import { createSpaRoutes } from "@getstrata/bootstrap/createSpaRoutes";
import { createWebRoutes } from "@getstrata/bootstrap/createWebRoutes";
import { routeRegistry } from "@getstrata/bootstrap/routeRegistry";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { LocalStorageDriver, StorageManager } from "@getstrata/core/storage/storage";

function dependencies(root: string): AppDependencies {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  return {
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache())),
    storage: new StorageManager(new LocalStorageDriver(root)),
  };
}

const filenames = [
  "café report.txt",
  "100%.txt",
  "literal%20.txt",
  "literal .txt",
  "literal%2Fname.txt",
  "%2e%2e%2fprivate.txt",
  "hash#query?.txt",
  " padded.txt ",
  "a+b.txt",
];
const files = filenames.map((name, index) => ({
  name,
  contents: `fixture ${index}: Žluťoučký kůň — ${name}`,
}));

for (const surface of ["server fallback", "web routes", "SPA routes"] as const) {
  test(`${surface} resolves encoded asset names without changing admission or traversal denial`, async () => {
    const owned = await mkdtemp(join(tmpdir(), "strata-asset-url-"));
    let directory = join(owned, "public/assets");
    let prefix = "/assets";
    const deps = dependencies(owned);
    let routes: AppRouteMap | undefined;
    if (surface === "web routes") {
      const publicAssets = join(process.cwd(), "public/assets");
      await mkdir(publicAssets, { recursive: true });
      directory = await mkdtemp(join(publicAssets, "url-"));
      prefix = `/assets/${basename(directory)}`;
      routes = createWebRoutes(deps, { modules: [] });
    } else if (surface === "SPA routes") {
      directory = join(owned, "dist");
      prefix = "/app";
      routes = createSpaRoutes(deps, { prefix, distDirectory: directory });
    }
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), "<!doctype html><p>SPA fallback</p>");
    const privateFile = join(owned, "outside.txt");
    await writeFile(privateFile, "private fixture outside the document root");
    for (const { name, contents } of files) {
      await writeFile(join(directory, name), contents);
    }
    const calls: string[] = [];
    const server = createWebServer({
      port: 0,
      native: { hostname: "127.0.0.1", development: false },
      publicDir: join(owned, "public"),
      routes,
      onRequest(request) {
        calls.push(request.method);
        if (request.headers.has("x-deny")) return new Response("denied", { status: 403 });
      },
    });
    try {
      for (const { name, contents } of files) {
        const url = new URL(`${prefix}/${encodeURIComponent(name)}`, server.url);
        const before = calls.length;
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(contents);
        expect(calls.length - before).toBe(1);

        const head = await fetch(url, { method: "HEAD" });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");
        expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(contents)));
        expect(calls.length - before).toBe(2);
      }
      const denied = await fetch(
        new URL(`${prefix}/${encodeURIComponent(filenames[0] ?? "")}`, server.url),
        { headers: { "x-deny": "1" } },
      );
      expect(denied.status).toBe(403);
      expect(await denied.text()).toBe("denied");

      const traversal = relative(directory, privateFile).replaceAll("/", "%2f");
      const escaped = await fetch(new URL(`${prefix}/${traversal}`, server.url));
      expect(escaped.status).toBe(404);
      expect(await escaped.text()).not.toContain("private fixture outside the document root");
      if (surface === "SPA routes") {
        const fallback = await fetch(new URL("/app/client-side-route", server.url));
        expect(await fallback.text()).toBe("<!doctype html><p>SPA fallback</p>");
      }
    } finally {
      await server.stop(true);
      if (surface === "web routes") {
        routeRegistry.clear();
        await rm(directory, { recursive: true, force: true });
      }
      await rm(owned, { recursive: true, force: true });
    }
  });
}
