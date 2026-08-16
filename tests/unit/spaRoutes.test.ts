import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createSpaRoutes, SPA_DIST_DIRECTORY } from "../../src/bootstrap/createSpaRoutes";
import { createMockDependencies } from "./testHelpers";

const DIST_DIR = join(process.cwd(), "frontend/dist");
const INDEX_FILE = join(DIST_DIR, "index.html");

function createDependencies() {
  return createMockDependencies(new ServiceContainer(), {} as never);
}

describe("createSpaRoutes", () => {
  beforeEach(async () => {
    await mkdir(DIST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(DIST_DIR, { recursive: true, force: true });
  });

  test("serves built index.html for /app/* fallback", async () => {
    await writeFile(INDEX_FILE, "<!doctype html><html><body>WorkHub SPA</body></html>");

    const routes = createSpaRoutes(createDependencies());
    const handler = routes["/app/*"];
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error("Expected /app/* route handler");
    }

    const response = await handler(new Request("http://localhost:3000/app/organizations"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("WorkHub SPA");
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
      error: "SPA build not found. Run `cd frontend && bun install && bun run build`.",
    });
  });

  test("redirects / to /app/", async () => {
    const routes = createSpaRoutes(createDependencies());
    const response = await routes["/"](new Request("http://localhost:3000/"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/");
  });

  test("exposes dist directory constant", () => {
    expect(SPA_DIST_DIRECTORY).toBe(join(process.cwd(), "frontend/dist"));
  });
});
