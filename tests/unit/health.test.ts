import { afterEach, describe, expect, test } from "bun:test";
import { CORE_CONFIG_TOKEN, REDIS_URL_CONFIG_KEY } from "@getstrata/bootstrap/config";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { checkDatabase, createHealthRoutes } from "@getstrata/bootstrap/health";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies as createBaseDependencies } from "./testHelpers";

let queryLog: string[] | undefined;
let databaseFailure: Error | undefined;
function createMockDependencies(
  ...args: Parameters<typeof createBaseDependencies>
): ReturnType<typeof createBaseDependencies> {
  const actual = createBaseDependencies(...args);
  const log = queryLog;
  const failure = databaseFailure;
  return {
    ...actual,
    invoke: (envelope, work) =>
      actual.invoke(envelope, (ports) => {
        const execute: typeof ports.database.execute = (statement) => {
          log?.push(statement.text);
          return failure ? Promise.reject(failure) : ports.database.execute(statement);
        };
        return work({ ...ports, database: Object.freeze({ ...ports.database, execute }) });
      }),
  };
}
const previousAppDebug = process.env.APP_DEBUG;

describe("createHealthRoutes", () => {
  afterEach(() => {
    queryLog = undefined;
    databaseFailure = undefined;
    restoreEnvVar("APP_DEBUG", previousAppDebug);
  });

  test("returns ok from /health without touching dependencies", async () => {
    const routes = createHealthRoutes(
      createMockDependencies(
        new ServiceContainer(),
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
    );

    const response = await routes["/health"]();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("pings the explicitly selected canonical database from checkDatabase", async () => {
    const queries: string[] = [];
    queryLog = queries;

    expect(await checkDatabase(createMockDependencies(new ServiceContainer()).invoke)).toBe(true);
    expect(queries).toEqual(["SELECT 1"]);
  });

  test("createHealthRoutes /ready uses its explicit canonical invocation", async () => {
    process.env.APP_DEBUG = "true";
    const queries: string[] = [];
    queryLog = queries;

    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, "");
    container.set(CORE_CONFIG_TOKEN, config);

    const routes = createHealthRoutes(
      createMockDependencies(
        container,
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
      { extra: { app: "sibling" } },
    );

    const response = await routes["/ready"]();
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
      app?: string;
    };

    expect(queries).toContain("SELECT 1");
    expect(body.checks.database).toBe("ok");
    expect(body.app).toBe("sibling");
    expect(body.status).toBe("ready");
    expect(response.status).toBe(200);
  });

  test("pingOnHealth includes database checks on /health", async () => {
    const routes = createHealthRoutes(
      createMockDependencies(
        new ServiceContainer(),
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
      { pingOnHealth: true },
    );

    const response = await routes["/health"]();
    const body = (await response.json()) as { status: string; checks: Record<string, string> };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });

  test("/ready omits check names unless APP_DEBUG is true", async () => {
    process.env.APP_DEBUG = "false";
    const routes = createHealthRoutes(
      createMockDependencies(
        new ServiceContainer(),
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
      { extra: { app: "hidden" } },
    );
    const response = await routes["/ready"]();
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.status).toBe(200);
  });

  test("returns readiness details from /ready", async () => {
    process.env.APP_DEBUG = "true";

    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, process.env.REDIS_URL ?? "");
    container.set(CORE_CONFIG_TOKEN, config);

    const routes = createHealthRoutes(
      createMockDependencies(
        container,
        new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      ),
    );

    const response = await routes["/ready"]();
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, string>;
    };

    expect(body.checks.database).toBe("ok");
    const redisStatus = body.checks.redis;

    if (!redisStatus) {
      throw new Error("Expected redis readiness check.");
    }

    expect(["ok", "skipped", "error"]).toContain(redisStatus);
    expect([200, 503]).toContain(response.status);
  });
});

describe("schema/container health probes", () => {
  afterEach(() => {
    queryLog = undefined;
    databaseFailure = undefined;
  });
  const dependencies = () => {
    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, "");
    container.set(CORE_CONFIG_TOKEN, config);
    return createMockDependencies(
      container,
      new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    );
  };
  test("text probe reports only readiness, ignores extra data and never caches", async () => {
    const routes = createHealthRoutes(dependencies(), {
      pingOnHealth: true,
      healthFormat: "text",
      schemaCheck: async () => true,
      extra: () => {
        throw new Error("Private data must not be evaluated");
      },
    });
    const response = await routes["/health"](new Request("http://unknown.invalid/health"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const rejected = await routes["/health"](
      new Request("http://localhost/health", { method: "POST" }),
    );
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("allow")).toBe("GET, HEAD");
  });
  test("missing schema and schema errors are sanitized as 503", async () => {
    for (const schemaCheck of [
      async () => false,
      async () => {
        throw new Error("private SQL details");
      },
    ]) {
      const response = await createHealthRoutes(dependencies(), {
        pingOnHealth: true,
        healthFormat: "text",
        schemaCheck,
      })["/health"]();
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("degraded");
    }
  });
  test("unavailable Redis cannot report a healthy text probe", async () => {
    const container = new ServiceContainer();
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, "redis://127.0.0.1:1");
    container.set(CORE_CONFIG_TOKEN, config);
    const deps = createMockDependencies(
      container,
      new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    );
    const response = await createHealthRoutes(deps, {
      pingOnHealth: true,
      healthFormat: "text",
      schemaCheck: async () => true,
    })["/health"]();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("degraded");
  });
  test("database failure does not become a successful schema probe", async () => {
    databaseFailure = new Error("private database error");
    const response = await createHealthRoutes(dependencies(), {
      pingOnHealth: true,
      healthFormat: "text",
      schemaCheck: async () => true,
    })["/health"]();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("degraded");
  });
});
