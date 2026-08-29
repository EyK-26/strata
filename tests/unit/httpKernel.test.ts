import { describe, expect, test } from "bun:test";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { wrapWebLogin } from "@getstrata/bootstrap/web/routing";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { tokenServiceToken } from "../../src/modules/user/provider";
import { restoreEnvVar } from "../helpers/restoreEnv";

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

  test("wrapWeb applies the web middleware group when views are enabled", async () => {
    const previous = process.env.FRONTEND_MODE;
    process.env.FRONTEND_MODE = "server-htmx";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = kernel.wrapWeb(async () => new Response("ok"));

      const getResponse = await handler(new Request("http://example.test/organizations"));
      expect(getResponse.status).toBe(200);
      expect(getResponse.headers.get("set-cookie")).toContain("workhub_csrf=");

      const postResponse = await handler(
        new Request("http://example.test/organizations", { method: "POST" }),
      );
      expect(postResponse.status).toBe(403);
      expect(await postResponse.text()).toContain("Invalid or missing CSRF token.");
    } finally {
      restoreEnvVar("FRONTEND_MODE", previous);
    }
  });

  test("wrapWebLogin applies the web group so CSRF failures become HTML 403", async () => {
    const previous = process.env.FRONTEND_MODE;
    process.env.FRONTEND_MODE = "server-htmx";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = wrapWebLogin(
        kernel,
        async () => new Response("ok"),
        async () => new Response("slow", { status: 429 }),
      );

      const postResponse = await handler(
        new Request("http://example.test/login", { method: "POST" }),
      );
      expect(postResponse.status).toBe(403);
      expect(await postResponse.text()).toContain("Invalid or missing CSRF token.");
    } finally {
      restoreEnvVar("FRONTEND_MODE", previous);
    }
  });

  test("wrapWebLogin replaces JSON 429 with the HTML throttle handler", async () => {
    const previous = process.env.FRONTEND_MODE;
    process.env.FRONTEND_MODE = "server-htmx";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = wrapWebLogin(
        kernel,
        async () => new Response("json-slow", { status: 429 }),
        async () => new Response("html-slow", { status: 429 }),
      );

      const response = await handler(new Request("http://example.test/login"));
      expect(response.status).toBe(429);
      expect(await response.text()).toBe("html-slow");
    } finally {
      restoreEnvVar("FRONTEND_MODE", previous);
    }
  });

  test("wrapSigned rejects unsigned URLs and allows valid ones", async () => {
    const previousMode = process.env.FRONTEND_MODE;
    const previousSecret = process.env.SIGNED_URL_SECRET;
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.SIGNED_URL_SECRET = "test-signed-url-secret";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = kernel.wrapWeb(kernel.wrapSigned(async () => new Response("ok")));

      const unsigned = await handler(new Request("http://example.test/reset-password"));
      expect(unsigned.status).toBe(403);
      expect(await unsigned.text()).toContain("Invalid or expired signed URL.");

      const signed = await handler(
        new Request(
          `http://example.test${temporarySignedUrl("/reset-password", 120, { email: "a@workhub.test" })}`,
        ),
      );
      expect(signed.status).toBe(200);
    } finally {
      restoreEnvVar("FRONTEND_MODE", previousMode);
      restoreEnvVar("SIGNED_URL_SECRET", previousSecret);
    }
  });

  test("wrapWebGuest redirects signed-in users and lets guests through", async () => {
    const previous = process.env.FRONTEND_MODE;
    process.env.FRONTEND_MODE = "server-htmx";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = kernel.wrapWebGuest(async () => new Response("login"));

      const guest = await handler(new Request("http://example.test/login"));
      expect(guest.status).toBe(200);
      expect(await guest.text()).toBe("login");

      const signedIn = await handler(
        new Request("http://example.test/login", {
          headers: { "x-authenticated-user-id": "1" },
        }),
      );
      expect(signedIn.status).toBe(302);
      expect(signedIn.headers.get("Location")).toBe("/organizations");
    } finally {
      restoreEnvVar("FRONTEND_MODE", previous);
    }
  });

  test("wrapWebGuest sends unverified sessions to the verify notice", async () => {
    const previousMode = process.env.FRONTEND_MODE;
    const previousVerify = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.FEATURE_EMAIL_VERIFICATION = "true";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = kernel.wrapWebGuest(async () => new Response("login"));

      const unverified = await handler(
        new Request("http://example.test/login", {
          headers: {
            "x-authenticated-user-id": "9",
            "x-authenticated-email-verified": "false",
          },
        }),
      );

      expect(unverified.status).toBe(302);
      expect(unverified.headers.get("Location")).toBe("/email/verify");
    } finally {
      restoreEnvVar("FRONTEND_MODE", previousMode);
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previousVerify);
    }
  });

  test("wrapWebAuthenticated redirects unverified HTML users when verification is required", async () => {
    const previousMode = process.env.FRONTEND_MODE;
    const previousVerify = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FRONTEND_MODE = "server-htmx";
    process.env.FEATURE_EMAIL_VERIFICATION = "true";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = kernel.wrapWebAuthenticated(async () => new Response("ok"));

      const unverified = await handler(
        new Request("http://example.test/organizations", {
          headers: {
            "x-authenticated-user-id": "9",
            "x-authenticated-email-verified": "false",
          },
        }),
      );

      expect(unverified.status).toBe(302);
      expect(unverified.headers.get("Location")).toBe("/email/verify");

      const verified = await handler(
        new Request("http://example.test/organizations", {
          headers: { "x-authenticated-user-id": "1" },
        }),
      );
      expect(verified.status).toBe(200);
    } finally {
      restoreEnvVar("FRONTEND_MODE", previousMode);
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previousVerify);
    }
  });

  test("wrapVerified returns JSON 403 for unverified API users", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";

    try {
      const kernel = createHttpKernel(createKernelDependencies());
      const handler = kernel.wrapVerified(async () => Response.json({ ok: true }));

      const unverified = await handler(
        new Request("http://example.test/api/v1/organizations", {
          headers: {
            accept: "application/json",
            "x-authenticated-user-id": "9",
            "x-authenticated-email-verified": "false",
          },
        }),
      );

      expect(unverified.status).toBe(403);
      expect(await unverified.json()).toEqual({
        error: "Your email address is not verified.",
      });
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
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
