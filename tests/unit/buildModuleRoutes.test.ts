import { describe, expect, test } from "bun:test";
import { buildModuleRoutes } from "@getstrata/bootstrap/buildModuleRoutes";
import {
  CORE_AUTH_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_QUEUE_TOKEN,
} from "@getstrata/bootstrap/config";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CORE_TOKEN_SERVICE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { SyncQueue } from "@getstrata/core/queue";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "./testHelpers";

const fixtureModule: AppModule = {
  name: "reports",
  routes() {
    return {
      "/reports/summary": async () => Response.json({ ok: true }),
    };
  },
};

function createTestDependencies() {
  const container = new ServiceContainer();
  const dependencies = createMockDependencies(
    container,
    new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  );

  dependencies.container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  dependencies.container.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  dependencies.container.set(CORE_QUEUE_TOKEN, new SyncQueue());
  dependencies.container.set(CORE_TOKEN_SERVICE_TOKEN, {
    requireAbility: () => undefined,
    tokenCan: () => true,
  });

  return dependencies;
}

const loginModule: AppModule = {
  name: "auth",
  routes({ kernel }) {
    return {
      "/api/v1/auth/csrf": {
        GET: kernel.wrap("api", async (request) =>
          Response.json({ token: resolveCsrfTokenForRequest(request) }),
        ),
      },
      "/api/v1/auth/login": {
        POST: kernel.wrap("api", async () => Response.json({ ok: true })),
      },
    };
  },
};

describe("buildModuleRoutes", () => {
  test("maps guest CSRF failures on wrap(api) routes to JSON 403", async () => {
    const previousTenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
    try {
      const dependencies = createTestDependencies();
      const routes = buildModuleRoutes(dependencies, {
        modules: [loginModule],
      });
      const login = (
        routes["/api/v1/auth/login"] as { POST: (request: Request) => Promise<Response> }
      ).POST;
      const csrfGet = (
        routes["/api/v1/auth/csrf"] as { GET: (request: Request) => Promise<Response> }
      ).GET;
      const blocked = await login(
        new Request("http://example.test/api/v1/auth/login", { method: "POST" }),
      );
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toEqual({ error: "Invalid or missing CSRF token." });

      const issued = await runWithRequestMeta({ ipAddress: null, userAgent: null }, async () =>
        csrfGet(new Request("http://example.test/api/v1/auth/csrf")),
      );
      expect(issued.status).toBe(200);
      const body = (await issued.json()) as { token: string };
      const cookie = issued.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      expect(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1))).toBe(body.token);
      expect(issued.headers.getSetCookie().filter((item) => item.includes("csrf="))).toHaveLength(
        1,
      );

      const allowed = await login(
        new Request("http://example.test/api/v1/auth/login", {
          method: "POST",
          headers: {
            cookie,
            "x-csrf-token": body.token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email: "demo@example.com" }),
        }),
      );
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({ ok: true });
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previousTenancy);
    }
  });

  test("builds prefixed module routes from supplied modules", () => {
    const dependencies = createTestDependencies();
    const routes = buildModuleRoutes(dependencies, {
      apiPrefix: "/api",
      modules: [fixtureModule],
    });

    expect(typeof routes["/api/reports/summary"]).toBe("function");
  });

  test("can append routes without clearing the OpenAPI registry", () => {
    const dependencies = createTestDependencies();
    const firstCount = buildModuleRoutes(dependencies, {
      apiPrefix: "/api",
      modules: [fixtureModule],
    });
    const secondCount = buildModuleRoutes(dependencies, {
      apiPrefix: "/api",
      modules: [fixtureModule],
      clearRegistry: false,
    });

    expect(Object.keys(firstCount).length).toBeGreaterThan(0);
    expect(Object.keys(secondCount).length).toBeGreaterThan(0);
  });
});
