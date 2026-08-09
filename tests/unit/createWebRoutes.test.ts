import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppRouteMap } from "../../src/bootstrap/contracts";
import { createWebRoutes, mergeWebRoutes } from "../../src/bootstrap/createWebRoutes";
import { createAppDependencies } from "../../src/bootstrap/dependencies";
import { routeRegistry } from "../../src/bootstrap/routeRegistry";

const PUBLIC_ASSETS_DIR = join(process.cwd(), "public/assets");

describe("createWebRoutes", () => {
  const previousFrontendMode = process.env.FRONTEND_MODE;

  beforeEach(async () => {
    routeRegistry.clear();
    process.env.FRONTEND_MODE = "server-htmx";
    await mkdir(PUBLIC_ASSETS_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousFrontendMode;
    }

    await rm(join(PUBLIC_ASSETS_DIR, "coverage-test.css"), { force: true });
  });

  test("registers a root redirect and module web routes", async () => {
    const routes = createWebRoutes(createAppDependencies());

    expect(routes["/"]).toBeDefined();
    const response = await routes["/"](new Request("http://localhost/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/organizations");

    expect(routes["/organizations"]).toBeDefined();
    expect(routes["/login"]).toBeDefined();
  });

  test("serves static assets from public/", async () => {
    await writeFile(join(PUBLIC_ASSETS_DIR, "coverage-test.css"), "body { color: black; }");

    const routes = createWebRoutes(createAppDependencies());
    const handler = routes["/assets/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /assets/* route handler");
    }

    const response = await handler(new Request("http://localhost/assets/coverage-test.css"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("body { color: black; }");
  });

  test("returns 404 HTML for missing assets", async () => {
    const routes = createWebRoutes(createAppDependencies());
    const handler = routes["/assets/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /assets/* route handler");
    }

    const response = await handler(new Request("http://localhost/assets/missing.css"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });
});

describe("mergeWebRoutes", () => {
  const previousFrontendMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    if (previousFrontendMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousFrontendMode;
    }
  });

  test("returns api routes unchanged when views are disabled", () => {
    process.env.FRONTEND_MODE = "api";
    const apiRoutes: AppRouteMap = {
      "/health": {
        GET: async () => Response.json({ ok: true }),
      },
    };

    expect(mergeWebRoutes(createAppDependencies(), apiRoutes)).toBe(apiRoutes);
  });

  test("merges web routes ahead of api routes when views are enabled", () => {
    process.env.FRONTEND_MODE = "server-htmx";
    const apiRoutes: AppRouteMap = {
      "/health": {
        GET: async () => Response.json({ ok: true }),
      },
    };

    const merged = mergeWebRoutes(createAppDependencies(), apiRoutes);

    expect(merged["/"]).toBeDefined();
    expect(merged["/health"]).toBeDefined();
    expect(merged["/organizations"]).toBeDefined();
  });
});
