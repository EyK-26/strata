import { describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { tokenServiceToken } from "../../src/modules/user/provider";

import { createMockDependencies } from "./testHelpers";

function createKernelDependencies(config?: ConfigStore): AppDependencies {
  const container = new ServiceContainer();
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));

  if (config) {
    container.set(CORE_CONFIG_TOKEN, config);
  }

  return createMockDependencies(
    container,
    new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
  );
}

describe("HttpKernel", () => {
  test("registers global middleware for logging, request id, and auth", () => {
    const kernel = createHttpKernel(createKernelDependencies());
    const middleware = kernel.globalMiddleware();

    expect(middleware.length).toBe(10);
  });

  test("skips api throttle middleware when config is not registered", () => {
    const kernel = createHttpKernel(createKernelDependencies());

    expect(kernel.group("api")).toEqual([]);
  });

  test("falls back to memory throttle middleware when redis url is missing", () => {
    const config = new ConfigStore();
    config.set(REDIS_URL_CONFIG_KEY, "");
    const kernel = createHttpKernel(createKernelDependencies(config));

    expect(kernel.group("api")).toHaveLength(1);
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
    const handler = kernel.wrapAbility("projects:delete", async () => Response.json({ ok: true }));

    const guestResponse = await handler(new Request("http://example.test/projects/1"));
    expect(guestResponse.status).toBe(401);
  });
});
