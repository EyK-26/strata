import { describe, expect, test } from "bun:test";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "../../src/bootstrap/config";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { ConfigStore } from "../../src/bootstrap/contracts";
import { ForbiddenError } from "../../src/core/errors/http";
import { tokenServiceToken } from "../../src/modules/user/provider";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import type { AppDependencies } from "../../src/bootstrap/contracts";

function createKernelDependencies(config?: ConfigStore): AppDependencies {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));

  if (config) {
    container.set(CORE_CONFIG_TOKEN, config);
  }

  return {
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  };
}

describe("HttpKernel", () => {
  test("registers global middleware for logging, request id, and auth", () => {
    const kernel = createHttpKernel(createKernelDependencies());
    const middleware = kernel.globalMiddleware();

    expect(middleware.length).toBe(9);
  });

  test("skips api throttle middleware when config is not registered", () => {
    const kernel = createHttpKernel(createKernelDependencies());

    expect(kernel.group("api")).toEqual([]);
  });

  test("skips api throttle middleware when redis url is missing", () => {
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, "");
    const kernel = createHttpKernel(createKernelDependencies(config));

    expect(kernel.group("api")).toEqual([]);
  });

  test("wrapAuthenticated applies require-auth middleware", async () => {
    const kernel = createHttpKernel(createKernelDependencies());
    const handler = kernel.wrapAuthenticated(async () => Response.json({ ok: true }));

    const response = await handler(new Request("http://example.test/protected"));

    expect(response.status).toBe(401);
  });

  test("wrapAbility rejects guests before ability checks", async () => {
    const dependencies = createKernelDependencies();
    dependencies.container.set(tokenServiceToken, {
      requireAbility: () => {
        throw new ForbiddenError("Token ability required.");
      },
      tokenCan: () => false,
    });

    const kernel = createHttpKernel(dependencies);
    const handler = kernel.wrapAbility("projects:delete", async () =>
      Response.json({ ok: true }),
    );

    const guestResponse = await handler(new Request("http://example.test/projects/1"));
    expect(guestResponse.status).toBe(401);
  });
});
