import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import {
  createSpaRoutes,
  mergeSpaRoutes,
  SPA_DIST_DIRECTORY,
} from "@getstrata/bootstrap/createSpaRoutes";
import { createMockDependencies } from "./testHelpers";

const DIST_DIR = join(process.cwd(), "frontend/dist");
const INDEX_FILE = join(DIST_DIR, "index.html");

function createDependencies() {
  return createMockDependencies(new ServiceContainer(), {} as never);
}

function asHandler(route: unknown): (request: Request) => Response | Promise<Response> {
  if (typeof route !== "function") {
    throw new Error("Expected a route handler function");
  }
  return route as (request: Request) => Response | Promise<Response>;
}

describe("createSpaRoutes", () => {
  const previousMode = process.env.FRONTEND_MODE;
  const previousPrefix = process.env.SPA_PREFIX;

  beforeEach(async () => {
    await mkdir(DIST_DIR, { recursive: true });
    delete process.env.SPA_PREFIX;
  });

  afterEach(async () => {
    await rm(DIST_DIR, { recursive: true, force: true });
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousMode;
    }
    if (previousPrefix === undefined) {
      delete process.env.SPA_PREFIX;
    } else {
      process.env.SPA_PREFIX = previousPrefix;
    }
  });

  test("serves built index.html for /app/* fallback", async () => {
    await writeFile(INDEX_FILE, "<!doctype html><html><body>Strata SPA</body></html>");

    const routes = createSpaRoutes(createDependencies());
    const handler = routes["/app/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /app/* route handler");
    }

    const response = await asHandler(handler)(
      new Request("http://localhost:3000/app/organizations"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Strata SPA");
  });

  test("returns 503 when SPA build is missing", async () => {
    await rm(INDEX_FILE, { force: true });

    const routes = createSpaRoutes(createDependencies());
    const handler = routes["/app/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /app/* route handler");
    }

    const response = await asHandler(handler)(new Request("http://localhost:3000/app/"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "SPA build not found. Run `bun run frontend:build` in your app.",
    });
  });

  test("redirects / to /app/ when views are off", async () => {
    process.env.FRONTEND_MODE = "spa-react";
    const routes = createSpaRoutes(createDependencies());
    const response = await asHandler(routes["/"])(new Request("http://localhost:3000/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/");
  });

  test("does not claim / when hybrid keeps staff HTML at /", async () => {
    process.env.FRONTEND_MODE = "hybrid";
    const routes = createSpaRoutes(createDependencies());

    expect(routes["/"]).toBeUndefined();
    expect(routes["/app"]).toBeDefined();
    expect(routes["/app/"]).toBeDefined();
    expect(routes["/app/*"]).toBeDefined();
  });

  test("registers prefix, prefix/, and prefix/* for a custom mount", async () => {
    const dist = join(process.cwd(), "tmp-apply-dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "index.html"), "<!doctype html><title>Apply</title>");
    await writeFile(join(dist, "app.js"), "window.apply = true;");

    try {
      const routes = createSpaRoutes(createDependencies(), {
        prefix: "/apply",
        distDirectory: dist,
      });

      expect(routes["/apply"]).toBeDefined();
      expect(routes["/apply/"]).toBeDefined();
      expect(routes["/apply/*"]).toBeDefined();
      expect(routes["/app/*"]).toBeUndefined();

      const document = await asHandler(routes["/apply"])(
        new Request("http://localhost:3000/apply"),
      );
      expect(document.status).toBe(200);
      expect(await document.text()).toContain("Apply");

      const slash = await asHandler(routes["/apply/"])(new Request("http://localhost:3000/apply/"));
      expect(slash.status).toBe(200);

      const asset = await asHandler(routes["/apply/*"])(
        new Request("http://localhost:3000/apply/app.js"),
      );
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("window.apply");
    } finally {
      await rm(dist, { recursive: true, force: true });
    }
  });

  test("reads SPA_PREFIX from the environment", async () => {
    process.env.FRONTEND_MODE = "spa-react";
    process.env.SPA_PREFIX = "/portal";
    const routes = createSpaRoutes(createDependencies());

    expect(routes["/portal/*"]).toBeDefined();
    expect(routes["/app/*"]).toBeUndefined();
    const response = await asHandler(routes["/"])(new Request("http://localhost:3000/"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/portal/");
  });

  test("wrap option runs around the document handler", async () => {
    await writeFile(INDEX_FILE, "<!doctype html><html><body>Strata SPA</body></html>");
    const routes = createSpaRoutes(createDependencies(), {
      wrap: () => async () => new Response("wrapped", { status: 418 }),
    });
    const response = await asHandler(routes["/app"])(new Request("http://localhost:3000/app"));
    expect(response.status).toBe(418);
    expect(await response.text()).toBe("wrapped");
  });

  test("exposes dist directory constant", () => {
    expect(SPA_DIST_DIRECTORY).toBe(join(process.cwd(), "frontend/dist"));
  });

  test("mergeSpaRoutes no-ops when the SPA is off", () => {
    process.env.FRONTEND_MODE = "server-htmx";
    const existing = { "/health": async () => new Response("ok") };
    const merged = mergeSpaRoutes(createDependencies(), existing);
    expect(merged).toBe(existing);
    expect(merged["/app/*"]).toBeUndefined();
  });

  test("mergeSpaRoutes keeps app routes on top of the SPA prefix", () => {
    process.env.FRONTEND_MODE = "hybrid";
    const existing = { "/apply": async () => new Response("module") };
    const merged = mergeSpaRoutes(createDependencies(), existing, { prefix: "/apply" });
    expect(merged["/apply"]).toBe(existing["/apply"]);
    expect(merged["/apply/*"]).toBeDefined();
  });
});
