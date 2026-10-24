import { afterEach, beforeEach, expect, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_CONFIG_TOKEN } from "@getstrata/bootstrap/config";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { runWithAuthContext } from "@getstrata/core/auth/authContext";
import { AuthManager } from "@getstrata/core/auth/guard";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { createCsrfTokenCookie } from "@getstrata/core/http/csrfToken";
import configProvider from "../../src/bootstrap/providers/config";
import { createMockDependencies } from "./testHelpers";

const targetOrigin = "https://forms.example.test";
const names = [
  "APP_ENV",
  "SESSION_SECRET",
  "AUTH_DEV_HEADERS",
  "FRONTEND_MODE",
  "CSRF_TARGET_ORIGIN",
  "DATABASE_URL",
] as const;
let previous: Map<(typeof names)[number], string | undefined>;
beforeEach(() => {
  previous = new Map(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    APP_ENV: "production",
    SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    AUTH_DEV_HEADERS: "false",
    FRONTEND_MODE: "server-htmx",
  });
});
afterEach(() => {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function submission(
  origin = targetOrigin,
  host = "forms.example.test",
  url = "http://forms.example.test/submit",
) {
  const csrf = createCsrfTokenCookie();
  const request = new Request(url, {
    method: "POST",
    headers: {
      Host: host,
      Origin: origin,
      Cookie: csrf.cookie.split(";")[0] ?? "",
      "X-CSRF-Token": csrf.token,
      "X-Forwarded-Proto": "http",
      "X-Forwarded-Host": "evil.example.test",
    },
    body: new URLSearchParams({ email: "invalid" }),
  });
  return request;
}

test("explicit target origin admits an HTTPS form on an HTTP upstream without transforming Request", async () => {
  const request = submission();
  const middleware = createCsrfMiddleware({ targetOrigin });
  const response = await middleware(request, async () => {
    expect(request.url).toBe("http://forms.example.test/submit");
    expect(request.headers.get("origin")).toBe(targetOrigin);
    expect((await request.formData()).get("email")).toBe("invalid");
    return new Response("validation", { status: 422 });
  });
  expect(response.status).toBe(422);
});

for (const value of [
  "",
  " ",
  "https://user@forms.example.test",
  "https://u:p@forms.example.test",
  "https://forms.example.test/path",
  "https://forms.example.test?",
  "https://forms.example.test?q=1",
  "https://forms.example.test#",
  "https://forms.example.test#fragment",
  "https://*.example.test",
  "https://forms.example.test,evil.example.test",
  "https://forms.example.test:99999",
  "file:///tmp/form",
  "ftp://forms.example.test",
  "null",
  "forms.example.test",
  "https://forms.example.test\\evil",
  " https://forms.example.test",
  "https://forms.example.test ",
  "https://forms%2eexample.test",
])
  test(`configured target origin fails before request admission: ${JSON.stringify(value)}`, () => {
    expect(() => createCsrfMiddleware({ targetOrigin: value })).toThrow(TypeError);
  });

for (const host of [
  "evil.example.test",
  "forms.example.test:8443",
  "forms.example.test,evil.example.test",
  "user@forms.example.test",
  "forms.example.test/path",
  "forms.example.test?x",
  "forms.example.test#x",
  "forms.example.test\\evil",
  "forms%2eexample.test",
  "forms .example.test",
  "",
])
  test(`configured host admission refuses ${JSON.stringify(host)} before safe-method token issuance`, async () => {
    let called = false;
    const request = new Request("http://forms.example.test/form", { headers: { Host: host } });
    await expect(
      createCsrfMiddleware({ targetOrigin })(request, async () => {
        called = true;
        return new Response("must not issue a cookie");
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(called).toBe(false);
  });

test("missing Host and conflicts between Host and URL are rejected", async () => {
  for (const request of [
    new Request("http://forms.example.test/form"),
    submission(targetOrigin, "forms.example.test", "http://evil.example.test/submit"),
  ])
    await expect(
      createCsrfMiddleware({ targetOrigin })(request, async () => new Response("bad")),
    ).rejects.toBeInstanceOf(ForbiddenError);
});

for (const origin of [
  "https://evil.example.test",
  "http://forms.example.test",
  "https://forms.example.test:8443",
  "null",
  "not-an-origin",
  `${targetOrigin}, https://evil.example.test`,
  `${targetOrigin}/`,
  `${targetOrigin}/path`,
  `${targetOrigin}?x`,
  `${targetOrigin}#fragment`,
  "https://user@forms.example.test",
])
  test(`configured policy refuses browser Origin ${JSON.stringify(origin)}`, async () => {
    await expect(
      createCsrfMiddleware({ targetOrigin })(submission(origin), async () => new Response("bad")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

test("all existing token requirements remain active with a configured target", async () => {
  for (const missing of ["origin", "cookie", "x-csrf-token"]) {
    const request = submission();
    request.headers.delete(missing);
    await expect(
      createCsrfMiddleware({ targetOrigin })(request, async () => new Response("bad")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  }
  const wrong = submission();
  wrong.headers.set("x-csrf-token", "invalid");
  await expect(
    createCsrfMiddleware({ targetOrigin })(wrong, async () => new Response("bad")),
  ).rejects.toBeInstanceOf(ForbiddenError);
  const mismatch = submission();
  mismatch.headers.set("cookie", createCsrfTokenCookie().cookie.split(";")[0] ?? "");
  await expect(
    createCsrfMiddleware({ targetOrigin })(mismatch, async () => new Response("bad")),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("host admission is not bypassed by verified non-cookie credentials or a CSRF-exempt path", async () => {
  for (const source of ["bearer", "basic"] as const)
    await expect(
      runWithAuthContext({ id: 1 }, source, () =>
        createCsrfMiddleware({ targetOrigin })(
          submission(targetOrigin, "evil.example.test"),
          async () => new Response("bad"),
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    createCsrfMiddleware({ targetOrigin })(
      new Request("http://evil.example.test/billing/webhooks/test"),
      async () => new Response("bad"),
    ),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("equivalent target authority casing and default ports are normalized without widening host admission", async () => {
  const response = await createCsrfMiddleware({ targetOrigin: "https://FORMS.example.test:443/" })(
    submission(targetOrigin, "FORMS.example.test:443", "http://forms.example.test:443/submit"),
    async () => new Response("validation", { status: 422 }),
  );
  expect(response.status).toBe(422);
});

test("the validated target is captured instead of following later caller mutation", async () => {
  const options = { targetOrigin };
  const middleware = createCsrfMiddleware(options);
  options.targetOrigin = "https://evil.example.test";
  expect((await middleware(submission(), async () => new Response("ok"))).status).toBe(200);
});

test("HttpKernel uses explicit config for web and cookie API routes without an app wrapper", async () => {
  const container = new ServiceContainer();
  const config = new ConfigStore();
  container.set(CORE_AUTH_TOKEN, new AuthManager({ resolve: () => null }));
  container.set(CORE_CONFIG_TOKEN, config);
  config.set("http.csrf.targetOrigin", targetOrigin);
  const kernel = createHttpKernel(createMockDependencies(container));
  try {
    const handler = async () => new Response("validation", { status: 422 });
    for (const route of [kernel.wrapWeb(handler), kernel.wrap("api", handler)]) {
      const response = await route(submission());
      expect(response.status).toBe(422);
    }
  } finally {
    kernel.dispose();
  }
});

test("HttpKernel refuses an invalid explicit policy during construction", () => {
  const container = new ServiceContainer();
  const config = new ConfigStore();
  container.set(CORE_CONFIG_TOKEN, config);
  config.set("http.csrf.targetOrigin", "https://forms.example.test/path");
  expect(() => createHttpKernel(createMockDependencies(container))).toThrow(TypeError);
});

test("the root config provider binds only an explicitly supplied CSRF target", async () => {
  process.env.DATABASE_URL = "sqlite://:memory:";
  const container = new ServiceContainer();
  const config = new ConfigStore();
  delete process.env.CSRF_TARGET_ORIGIN;
  const context = { container, config, dependencies: { container }, onCleanup: () => {} };
  await configProvider.register?.(context);
  expect(config.get("http.csrf.targetOrigin")).toBeUndefined();
  process.env.CSRF_TARGET_ORIGIN = targetOrigin;
  await configProvider.register?.(context);
  expect(config.get("http.csrf.targetOrigin")).toBe(targetOrigin);
});

for (const value of [null, 42, false, {}, []])
  test(`untyped configuration cannot bypass startup validation: ${JSON.stringify(value)}`, () => {
    const container = new ServiceContainer();
    const config = new ConfigStore();
    container.set(CORE_CONFIG_TOKEN, config);
    config.set("http.csrf.targetOrigin", value);
    expect(() => createHttpKernel(createMockDependencies(container))).toThrow(TypeError);
  });

for (const host of [
  "-forms.example.test",
  "forms-.example.test",
  "forms..example.test",
  "forms_example.test",
  `${"x".repeat(64)}.example.test`,
  `${"x".repeat(63)}.${"x".repeat(63)}.${"x".repeat(63)}.${"x".repeat(63)}`,
])
  test(`invalid DNS target authority is rejected: ${host}`, () => {
    expect(() => createCsrfMiddleware({ targetOrigin: `https://${host}` })).toThrow(TypeError);
  });

for (const origin of ["http://localhost:8312", "https://[::1]:8312", "https://forms.example.test."])
  test(`explicit local, IPv6 and absolute DNS authorities remain bounded: ${origin}`, async () => {
    const request = submission(origin, new URL(origin).host, `${origin}/submit`);
    expect(
      (
        await createCsrfMiddleware({ targetOrigin: origin })(
          request,
          async () => new Response("ok"),
        )
      ).status,
    ).toBe(200);
  });

test("custom transports with invalid request URL metadata fail closed", async () => {
  const request = submission();
  Object.defineProperty(request, "url", { value: "invalid" });
  await expect(
    createCsrfMiddleware({ targetOrigin })(request, async () => new Response("bad")),
  ).rejects.toBeInstanceOf(ForbiddenError);
  const otherProtocol = submission(
    targetOrigin,
    "forms.example.test",
    "ftp://forms.example.test/form",
  );
  await expect(
    createCsrfMiddleware({ targetOrigin })(otherProtocol, async () => new Response("bad")),
  ).rejects.toBeInstanceOf(ForbiddenError);
});
