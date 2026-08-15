import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { pinWorkhubIntegrationEnv } from "../helpers/integrationEnv";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running integration tests.");
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const previousFrontendMode = process.env.FRONTEND_MODE;
const DIST_DIR = join(process.cwd(), "frontend/dist");

beforeAll(async () => {
  pinWorkhubIntegrationEnv();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.QUEUE_DRIVER = "sync";
  process.env.FRONTEND_MODE = "spa-react";

  await mkdir(DIST_DIR, { recursive: true });
  await writeFile(
    join(DIST_DIR, "index.html"),
    '<!doctype html><html><body><div id="root">WorkHub SPA</div></body></html>',
  );

  const [{ freshDatabase }, { createAppDependencies }, { createRoutes }] = await Promise.all([
    import("../../src/db/migrations/runner"),
    import("../../src/bootstrap/dependencies"),
    import("../../src/bootstrap/createRoutes"),
  ]);

  await freshDatabase({ seed: true });

  server = Bun.serve({
    port: 0,
    routes: createRoutes(createAppDependencies()),
  });

  baseUrl = server.url.toString().replace(/\/$/, "");
});

afterAll(() => {
  server.stop(true);

  if (previousFrontendMode === undefined) {
    delete process.env.FRONTEND_MODE;
  } else {
    process.env.FRONTEND_MODE = previousFrontendMode;
  }
});

describe("spa-react frontend routes", () => {
  test("GET / redirects to /app/", async () => {
    const response = await fetch(baseUrl, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/");
  });

  test("GET /app/ serves the SPA shell", async () => {
    const response = await fetch(`${baseUrl}/app/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("WorkHub SPA");
  });

  test("GET /app/organizations falls back to index.html for client routing", async () => {
    const response = await fetch(`${baseUrl}/app/organizations`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("WorkHub SPA");
  });

  test("POST /api/v1/auth/login returns bearer token for SPA clients", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@workhub.test",
        password: "password",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { token: string };
    expect(body.token.length).toBeGreaterThan(20);

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${body.token}` },
    });

    expect(meResponse.status).toBe(200);
  });
});
