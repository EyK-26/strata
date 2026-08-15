import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appConfig } from "../../src/config/app";
import { createTestApp } from "../../src/testing/createTestApp";
import { pinWorkhubIntegrationEnv } from "../helpers/integrationEnv";

describe("createTestApp", () => {
  const apps: Array<Awaited<ReturnType<typeof createTestApp>>> = [];

  beforeAll(() => {
    pinWorkhubIntegrationEnv();
  });

  afterAll(() => {
    for (const app of apps) {
      app.stop();
    }
  });

  test("starts a test server with WorkHub routes", async () => {
    const app = await createTestApp({
      fresh: process.env.WORKHUB_SKIP_TEST_BOOTSTRAP !== "1",
    });
    apps.push(app);

    const response = await fetch(`${app.baseUrl}${appConfig.apiPrefix}/reports/summary`, {
      headers: {
        authorization: "Bearer workhub-admin-test-token",
      },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { organization_count: number };
    expect(body.organization_count).toBeGreaterThanOrEqual(2);
  });

  test("exposes container-resolved dependencies for unit-style route tests", async () => {
    const app = await createTestApp();
    apps.push(app);

    expect(app.dependencies.container.resolve("organization.service")).toBeDefined();
    expect(app.routes[`${appConfig.apiPrefix}/reports/summary`]).toBeDefined();
  });
});
