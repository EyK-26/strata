import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CORE_CACHE_TOKEN } from "@getstrata/bootstrap/config";
import { createTestApp } from "../../src/testing/createTestApp";
import { pinSeededIntegrationEnv } from "../helpers/integrationEnv";

describe("createTestApp", () => {
  const apps: Array<Awaited<ReturnType<typeof createTestApp>>> = [];

  beforeAll(() => {
    pinSeededIntegrationEnv();
  });

  afterAll(() => {
    for (const app of apps) {
      app.stop();
    }
  });

  test("starts a test server with health routes", async () => {
    const app = await createTestApp();
    apps.push(app);

    const response = await fetch(`${app.baseUrl}/health`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status ?? "ok").toBeTruthy();
  });

  test("exposes container-resolved dependencies for unit-style route tests", async () => {
    const app = await createTestApp();
    apps.push(app);

    expect(app.dependencies.container.resolve(CORE_CACHE_TOKEN)).toBeDefined();
    expect(app.routes["/health"]).toBeDefined();
  });
});
