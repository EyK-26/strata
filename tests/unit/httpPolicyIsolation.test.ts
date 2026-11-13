import { expect, test } from "bun:test";
import { CORE_CONFIG_TOKEN } from "@getstrata/bootstrap/config";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { readClientIp } from "@getstrata/core/http/clientIp";
import { createCorsMiddleware } from "@getstrata/core/http/corsMiddleware";
import { validateUploadFile } from "@getstrata/core/http/parseMultipartUpload";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { createThrottleMiddleware } from "@getstrata/core/http/throttleMiddleware";
import { isPublicReadsEnabled } from "@getstrata/core/security/publicReads";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
import { resolveHttpResponsePolicy } from "../../src/bootstrap/providers/config";
import { createMockDependencies } from "./testHelpers";

const request = (origin: string) =>
  new Request("https://api.test/resource", { headers: { origin } });

test("two HTTP owners retain origins, headers, body limits and late-created API groups after environment mutation", async () => {
  const sourceA = {
    APP_URL: "https://a.test/",
    CORS_ADDITIONAL_ALLOWED_HEADERS: "X-App-A",
    MAX_REQUEST_BODY_BYTES: "4",
    RATE_LIMIT_PER_MINUTE: "1",
  };
  const sourceB = {
    APP_URL: "https://b.test",
    CORS_ADDITIONAL_ALLOWED_HEADERS: "X-App-B",
    MAX_REQUEST_BODY_BYTES: "8",
    RATE_LIMIT_PER_MINUTE: "2",
  };
  const policyA = resolveHttpResponsePolicy(sourceA);
  const policyB = resolveHttpResponsePolicy(sourceB);
  const make = (policy: typeof policyA) => {
    const container = new ServiceContainer();
    container.set(CORE_CONFIG_TOKEN, new ConfigStore());
    return createHttpKernel(
      createMockDependencies(container, undefined, undefined, undefined, {
        metadata: () => {
          throw new Error("No metadata needed by response-policy probes.");
        },
        tenancy: "none",
        production: false,
        allowTenantDevHeaders: false,
        responsePolicy: policy,
      }),
    );
  };
  const kernelA = make(policyA);
  const kernelB = make(policyB);
  const saved = {
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
    MAX_REQUEST_BODY_BYTES: process.env.MAX_REQUEST_BODY_BYTES,
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE,
  };
  try {
    sourceA.APP_URL = "https://evil.test";
    sourceA.MAX_REQUEST_BODY_BYTES = "9999";
    process.env.CORS_ALLOWED_ORIGINS = "*";
    process.env.MAX_REQUEST_BODY_BYTES = "9999";
    process.env.RATE_LIMIT_PER_MINUTE = "9999";
    const respondA = withMiddleware(...kernelA.globalMiddleware())(
      async (req) => new Response(await req.text()),
    );
    const respondB = withMiddleware(...kernelB.globalMiddleware())(
      async (req) => new Response(await req.text()),
    );
    for (const [respond, ownOrigin, ownHeader, foreignHeader] of [
      [respondA, "https://a.test", "X-App-A", "X-App-B"],
      [respondB, "https://b.test", "X-App-B", "X-App-A"],
    ] as const) {
      const own = await respond(request(ownOrigin));
      expect(own.headers.get("access-control-allow-origin")).toBe(ownOrigin);
      expect(own.headers.get("access-control-allow-headers")).toContain(ownHeader);
      expect(own.headers.get("access-control-allow-headers")).not.toContain(foreignHeader);
      expect(
        (await respond(request("https://evil.test"))).headers.get("access-control-allow-origin"),
      ).toBeNull();
    }
    expect(
      (await respondA(new Request("https://api.test", { method: "POST", body: "12345" }))).status,
    ).toBe(413);
    expect(
      (await respondB(new Request("https://api.test", { method: "POST", body: "12345" }))).status,
    ).toBe(200);
    const apiA = withMiddleware(...kernelA.group("api"))(() => new Response("a"));
    const apiB = withMiddleware(...kernelB.group("api"))(() => new Response("b"));
    await runWithRequestMeta({ ipAddress: "203.0.113.15", userAgent: null }, async () => {
      for (const [api, expected] of [
        [apiA, [200, 429]],
        [apiB, [200, 200, 429]],
      ] as const) {
        for (const status of expected)
          expect((await api(new Request("https://api.test"))).status).toBe(status);
      }
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    kernelA.dispose();
    kernelB.dispose();
  }
});

test("captured throttle namespace and forwarded-header trust cannot move a distributed bucket", async () => {
  const keys: string[] = [];
  const quotaIdentities: string[] = [];
  const options = {
    redisUrl: "redis://unused",
    namespace: "app-a",
    trustForwardedFor: false,
    maxAttempts: 1,
    decaySeconds: 60,
    redisClient: {
      send: async (_command: string, args: string[]) => {
        keys.push(args[2] ?? "");
        return keys.length;
      },
    },
    quotaPolicy: ({ identity }: { identity: string }) => {
      quotaIdentities.push(identity);
      return 1;
    },
  };
  const throttle = createThrottleMiddleware(options);
  const saved = {
    APP_KEY_PREFIX: process.env.APP_KEY_PREFIX,
    TRUST_FORWARDED_FOR: process.env.TRUST_FORWARDED_FOR,
  };
  try {
    options.namespace = "mutated";
    options.trustForwardedFor = true;
    const req = new Request("https://api.test", {
      headers: { "x-forwarded-for": "198.51.100.99" },
    });
    await runWithRequestMeta({ ipAddress: "203.0.113.8", userAgent: null }, async () => {
      expect((await throttle(req, async () => new Response("ok"))).status).toBe(200);
      process.env.APP_KEY_PREFIX = "other-app";
      process.env.TRUST_FORWARDED_FOR = "true";
      expect((await throttle(req, async () => new Response("ok"))).status).toBe(429);
      expect(readClientIp(req)).toBe("203.0.113.8");
    });
    expect(keys[0]).toStartWith("app-a:throttle:");
    expect(keys[1]).toBe(keys[0]);
    expect(quotaIdentities).toEqual(["203.0.113.8", "203.0.113.8"]);
  } finally {
    throttle.dispose();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("public upload, token expiry and public-read helpers consume explicit policy", async () => {
  const binary = new File(["12345"], "binary", { type: "application/octet-stream" });
  await expect(
    validateUploadFile(binary, "file", { maxBytes: 4, allowUnknownMime: true }),
  ).rejects.toThrow("4 byte limit");
  await expect(
    validateUploadFile(binary, "file", { maxBytes: 8, allowUnknownMime: false }),
  ).rejects.toThrow("not allowed");
  expect(
    (await validateUploadFile(binary, "file", { maxBytes: 8, allowUnknownMime: true })).size,
  ).toBe(5);
  expect(resolveDefaultTokenExpiryDays("30")).toBe(30);
  expect(resolveDefaultTokenExpiryDays()).toBeNull();
  expect(isPublicReadsEnabled(true)).toBe(true);
  expect(isPublicReadsEnabled()).toBe(false);
});

test("native HTTP preflights retain independent owner policies after ambient environment changes", async () => {
  const a = createWebServer({
    port: 0,
    native: { hostname: "127.0.0.1" },
    env: { APP_URL: "https://a.test" },
    routes: { "/read": () => new Response("a") },
  });
  const b = createWebServer({
    port: 0,
    native: { hostname: "127.0.0.1" },
    env: { APP_URL: "https://b.test" },
    routes: { "/read": () => new Response("b") },
  });
  const saved = process.env.CORS_ALLOWED_ORIGINS;
  try {
    process.env.CORS_ALLOWED_ORIGINS = "*";
    for (const [server, own, foreign] of [
      [a, "https://a.test", "https://b.test"],
      [b, "https://b.test", "https://a.test"],
    ] as const) {
      for (const origin of [own, foreign]) {
        const response = await fetch(`http://127.0.0.1:${server.port}/read`, {
          method: "OPTIONS",
          headers: { origin },
        });
        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe(
          origin === own ? own : null,
        );
      }
    }
  } finally {
    a.stop(true);
    b.stop(true);
    if (saved === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = saved;
  }
});

test("core CORS defaults grant no ambient cross-origin access and reject malformed explicit origins", async () => {
  const middleware = createCorsMiddleware();
  expect(
    (await middleware(request("https://ambient.test"), async () => new Response("ok"))).headers.get(
      "access-control-allow-origin",
    ),
  ).toBeNull();
  for (const allowedOrigins of ["*", [1], null])
    expect(() =>
      createCorsMiddleware({ allowedOrigins: allowedOrigins as unknown as string[] }),
    ).toThrow(TypeError);
});
