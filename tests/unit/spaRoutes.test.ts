import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createSpaRoutes, SPA_DIST_DIRECTORY } from "@getstrata/bootstrap/createSpaRoutes";
import { createMockDependencies } from "./testHelpers";

const DIST_DIR = join(process.cwd(), "frontend/dist");
const INDEX_FILE = join(DIST_DIR, "index.html");

function createDependencies() {
  return createMockDependencies(new ServiceContainer(), {} as never);
}

describe("createSpaRoutes", () => {
  const previousMode = process.env.FRONTEND_MODE;

  beforeEach(async () => {
    await mkdir(DIST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(DIST_DIR, { recursive: true, force: true });
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousMode;
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

    const response = await handler(new Request("http://localhost:3000/app/organizations"));

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

    const response = await handler(new Request("http://localhost:3000/app/"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "SPA build not found. Run `bun run frontend:build` in your app.",
    });
  });

  test("redirects / to /app/ when views are off", async () => {
    process.env.FRONTEND_MODE = "spa-react";
    const routes = createSpaRoutes(createDependencies());
    const response = await routes["/"](new Request("http://localhost:3000/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/");
  });

  test("does not claim / when hybrid keeps staff HTML at /", async () => {
    process.env.FRONTEND_MODE = "hybrid";
    const routes = createSpaRoutes(createDependencies());

    expect(routes["/"]).toBeUndefined();
    expect(routes["/app/*"]).toBeDefined();
  });

  test("exposes dist directory constant", () => {
    expect(SPA_DIST_DIRECTORY).toBe(join(process.cwd(), "frontend/dist"));
  });
});
