import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CORE_AUTH_TOKEN,
  CORE_CONFIG_TOKEN,
  CSRF_TARGET_ORIGIN_CONFIG_KEY,
} from "@getstrata/bootstrap/config";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { AuthManager } from "@getstrata/core/auth/guard";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { createTenantMiddleware } from "@getstrata/core/tenant/tenantMiddleware";

// Retain the opt-out transport characterization and every original security control.
// The explicit target-policy cases must reach validation without the app adapter.
// Runs without application/database boot, email, or access to private configuration.
const directory = await mkdtemp(join(tmpdir(), "strata-csrf-proxy-"));
const keyPath = join(directory, "key.pem");
const certPath = join(directory, "cert.pem");
const generated = Bun.spawnSync([
  "openssl",
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "1",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-subj",
  "/CN=127.0.0.1",
  "-addext",
  "subjectAltName=IP:127.0.0.1,DNS:localhost",
]);
if (generated.exitCode !== 0) {
  await rm(directory, { recursive: true });
  throw new Error(`Could not generate owned TLS fixture: ${generated.stderr.toString()}`);
}
const key = await readFile(keyPath, "utf8");
const cert = await readFile(certPath, "utf8");
const environmentNames = [
  "APP_ENV",
  "NODE_ENV",
  "APP_URL",
  "APP_KEY_PREFIX",
  "SESSION_SECRET",
  "CSRF_COOKIE_NAME",
  "AUTH_DEV_HEADERS",
  "TRUST_FORWARDED_FOR",
  "CORS_ALLOWED_ORIGINS",
  "TENANCY_DRIVER",
  "FRONTEND_MODE",
] as const;
let previous: Map<(typeof environmentNames)[number], string | undefined>;
beforeEach(() => {
  previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    APP_ENV: "production",
    APP_KEY_PREFIX: "proxy_fixture",
    AUTH_DEV_HEADERS: "false",
    SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
    TENANCY_DRIVER: "column",
    FRONTEND_MODE: "server-htmx",
  });
  delete process.env.CSRF_COOKIE_NAME;
});
afterEach(() => {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
afterAll(() => rm(directory, { recursive: true }));

// Exact app adapter behavior, copied for this fixture only. This is not its replacement.
function appAdapter(request: Request, publicOrigin: string): Request | null {
  const incoming = new URL(request.url);
  const expected = new URL(publicOrigin);
  if (incoming.origin === expected.origin) return request;
  if (
    incoming.protocol !== "http:" ||
    expected.protocol !== "https:" ||
    incoming.host !== expected.host
  )
    return null;
  return new Request(`${expected.origin}${incoming.pathname}${incoming.search}`, request);
}

type Observation = {
  protocol: string;
  host: string;
  browserOrigin: string | null;
  forwardedProto: string | null;
  forwardedHost: string | null;
  peer: string | null;
  tokenValidHandlerReached: boolean;
  requestIdentityPreserved: boolean;
};

async function fixture(
  options: {
    adapter?: boolean;
    trustedTenantProxy?: boolean;
    nativeTls?: boolean;
    targetOrigin?: boolean;
    kernel?: boolean;
  } = {},
) {
  const observations: Observation[] = [];
  let csrf = createCsrfMiddleware();
  let kernel: ReturnType<typeof createHttpKernel> | undefined;
  let publicOrigin = "";
  const selectTenant = options.trustedTenantProxy
    ? createTenantMiddleware({
        publicTenancy: {
          trustedProxyAddresses: ["127.0.0.1"],
          resolveTenantId: async (hostname) => (hostname === "127.0.0.1" ? 1 : null),
        },
        resolveTenant: async (id) => ({ id, slug: "fixture" }),
      })
    : null;
  const handler = async (incoming: Request) => {
    // Bun may expose a relative URL for a malformed wire Host. Observe it without
    // normalizing it; the configured framework boundary must reject the original Request.
    let url: URL | null = null;
    try {
      url = new URL(incoming.url);
    } catch {
      /* diagnostic only */
    }
    const observation: Observation = {
      protocol: url?.protocol ?? "unparseable",
      host: url?.host ?? "unparseable",
      browserOrigin: incoming.headers.get("origin"),
      forwardedProto: incoming.headers.get("x-forwarded-proto"),
      forwardedHost: incoming.headers.get("x-forwarded-host"),
      peer: currentRequestMeta().peerAddress ?? null,
      tokenValidHandlerReached: false,
      requestIdentityPreserved: false,
    };
    observations.push(observation);
    const request = options.adapter ? appAdapter(incoming, publicOrigin) : incoming;
    if (!request) return new Response("Unrecognized request host.", { status: 400 });
    observation.requestIdentityPreserved = request === incoming;
    try {
      const protect = () =>
        csrf(request, async () => {
          if (request.method === "GET")
            return new Response(
              `<form method="post"><input name="_token" value="${resolveCsrfTokenForRequest(request)}"><input name="email" value="invalid"><button>Submit</button></form>`,
              {
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                },
              },
            );
          observation.tokenValidHandlerReached = true;
          const form = await request.formData();
          return Response.json(
            {
              email: form.get("email"),
              path: new URL(request.url).pathname,
              search: new URL(request.url).search,
              ...("params" in request &&
              typeof request.params === "object" &&
              request.params !== null
                ? { id: (request.params as { id?: string }).id }
                : {}),
            },
            { status: 422 },
          );
        });
      return selectTenant ? await selectTenant(request, protect) : await protect();
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 403)
        return new Response(error.message, { status: 403 });
      throw error;
    }
  };
  const backend = createWebServer({
    port: 0,
    native: {
      hostname: "127.0.0.1",
      ...(options.nativeTls ? { tls: { key, cert } } : {}),
    },
    routes: {
      "/etf": { GET: handler, POST: handler },
      "/etf/:id": { GET: handler, POST: handler },
    },
  });
  const edge = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { key, cert },
    async fetch(request) {
      const headers = new Headers(request.headers);
      // Controlled ingress overwrites these fields; no request can select an upstream.
      const host = headers.get("host");
      if (!host) return new Response("Missing host", { status: 400 });
      headers.set("x-forwarded-proto", "https");
      headers.set("x-forwarded-host", host);
      headers.set("x-forwarded-for", "127.0.0.1");
      headers.delete("forwarded");
      headers.delete("content-length");
      const url = new URL(request.url);
      return fetch(new URL(url.pathname + url.search, backend.url), {
        method: request.method,
        headers,
        ...(request.method === "POST" ? { body: await request.arrayBuffer() } : {}),
        redirect: "manual",
        tls: { ca: cert },
      });
    },
  });
  publicOrigin = edge.url.origin;
  if (options.kernel) {
    const container = new ServiceContainer();
    const config = new ConfigStore();
    container.set(CORE_AUTH_TOKEN, new AuthManager({ resolve: () => null }));
    container.set(CORE_CONFIG_TOKEN, config);
    config.set(CSRF_TARGET_ORIGIN_CONFIG_KEY, publicOrigin);
    kernel = createHttpKernel({
      container,
      cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
      storage: new StorageManager(createStorageDriver()),
    });
    const ownedKernel = kernel;
    csrf = async (request, next) => await ownedKernel.wrapWeb(async () => next())(request);
  } else if (options.targetOrigin) csrf = createCsrfMiddleware({ targetOrigin: publicOrigin });
  Object.assign(process.env, { APP_URL: publicOrigin, CORS_ALLOWED_ORIGINS: publicOrigin });
  return {
    backend,
    edge,
    publicOrigin,
    observations,
    close: async () => {
      await edge.stop(true);
      await backend.stop(true);
      kernel?.dispose();
    },
  };
}

async function exchange(origin: string) {
  const response = await fetch(`${origin}/etf`, { tls: { ca: cert } });
  expect(response.status).toBe(200);
  const html = await response.text();
  const token = html.match(/name="_token" value="([^"]+)"/)?.[1];
  expect(token).toBeTruthy();
  if (!token) throw new Error("Owned form did not render its CSRF token.");
  const setCookie = response.headers.getSetCookie();
  expect(setCookie).toHaveLength(1);
  expect(setCookie[0]).toContain("; Secure");
  expect(setCookie[0]).toContain("HttpOnly; SameSite=Lax");
  return { token, cookie: setCookie.map((value) => value.split(";")[0]).join("; ") };
}

test("correct APP_URL, CORS and client-IP trust do not resolve TLS-offload CSRF origin mismatch", async () => {
  const f = await fixture();
  process.env.TRUST_FORWARDED_FOR = "true";
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(`${f.publicOrigin}/etf`, {
      method: "POST",
      tls: { ca: cert },
      headers: { Cookie: cookie, Origin: f.publicOrigin },
      body: new URLSearchParams({ _token: token, email: "invalid" }),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Cross-site cookie requests are not allowed.");
    expect(f.observations.at(-1)).toMatchObject({
      protocol: "http:",
      host: new URL(f.publicOrigin).host,
      browserOrigin: f.publicOrigin,
      forwardedProto: "https",
      peer: "127.0.0.1",
      tokenValidHandlerReached: false,
    });
  } finally {
    await f.close();
  }
});

test("trusted tenant proxy selection does not change CSRF's target scheme", async () => {
  const f = await fixture({ trustedTenantProxy: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(`${f.publicOrigin}/etf`, {
      method: "POST",
      tls: { ca: cert },
      headers: { Cookie: cookie, Origin: f.publicOrigin },
      body: new URLSearchParams({ _token: token }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site cookie requests are not allowed." });
  } finally {
    await f.close();
  }
});

test("the existing app adapter restores the full flow and preserves path, query and form data", async () => {
  const f = await fixture({ adapter: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(`${f.publicOrigin}/etf?source=proxy`, {
      method: "POST",
      tls: { ca: cert },
      headers: {
        Cookie: cookie,
        Origin: f.publicOrigin,
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "evil.example.test",
      },
      body: new URLSearchParams({ _token: token, email: "invalid" }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      email: "invalid",
      path: "/etf",
      search: "?source=proxy",
    });
    expect(f.observations.at(-1)?.tokenValidHandlerReached).toBe(true);
  } finally {
    await f.close();
  }
});

test("explicit target origin replaces the app adapter on a real HTTPS-to-HTTP form flow", async () => {
  const f = await fixture({ targetOrigin: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(`${f.publicOrigin}/etf?source=target-policy`, {
      method: "POST",
      tls: { ca: cert },
      headers: { Cookie: cookie, Origin: f.publicOrigin },
      body: new URLSearchParams({ _token: token, email: "invalid" }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      email: "invalid",
      path: "/etf",
      search: "?source=target-policy",
    });
    expect(f.observations.at(-1)).toMatchObject({
      protocol: "http:",
      browserOrigin: f.publicOrigin,
      forwardedProto: "https",
      tokenValidHandlerReached: true,
    });
  } finally {
    await f.close();
  }
});

for (const boundary of ["adapter", "target", "kernel"] as const)
  for (const [name, kind] of [
    ["missing token", "no-token"],
    ["invalid token", "wrong-token"],
    ["missing cookie", "no-cookie"],
    ["cross origin", "cross"],
    ["missing Origin", "no-origin"],
    ["opaque Origin", "opaque"],
    ["malformed Origin", "malformed"],
    ["multiple origins", "multiple"],
    ["wrong scheme", "http"],
    ["wrong port", "port"],
    ["conflicting Host", "host"],
  ] as const)
    test(`${boundary} retains rejection: ${name}`, async () => {
      const f = await fixture({
        adapter: boundary === "adapter",
        targetOrigin: boundary === "target",
        kernel: boundary === "kernel",
      });
      try {
        const { token, cookie } = await exchange(f.publicOrigin);
        const headers = new Headers({ Cookie: cookie, Origin: f.publicOrigin });
        const body = new URLSearchParams({ _token: token, email: "invalid" });
        if (kind === "no-token") body.delete("_token");
        if (kind === "wrong-token") body.set("_token", "invalid");
        if (kind === "no-cookie") headers.delete("cookie");
        if (kind === "no-origin") headers.delete("origin");
        if (kind === "cross") headers.set("origin", "https://evil.example.test");
        if (kind === "opaque") headers.set("origin", "null");
        if (kind === "malformed") headers.set("origin", "not-an-origin");
        if (kind === "multiple")
          headers.set("origin", `${f.publicOrigin}, https://evil.example.test`);
        if (kind === "http") headers.set("origin", f.publicOrigin.replace("https:", "http:"));
        if (kind === "port") headers.set("origin", "https://127.0.0.1:1");
        if (kind === "host") headers.set("host", "evil.example.test");
        const response = await fetch(`${f.publicOrigin}/etf`, {
          method: "POST",
          tls: { ca: cert },
          headers,
          body,
        });
        expect(response.status).toBe(kind === "host" && boundary === "adapter" ? 400 : 403);
        expect(f.observations.at(-1)?.tokenValidHandlerReached).toBe(false);
      } finally {
        await f.close();
      }
    });

for (const forwarded of [
  { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "trusted.example.test" },
  { Forwarded: 'for=127.0.0.1;proto=https;host="trusted.example.test"' },
  {
    "X-Forwarded-Proto": "https,http",
    "X-Forwarded-Host": "trusted.example.test,evil.example.test",
  },
] as const)
  test(`direct HTTP ignores forwarding claim ${JSON.stringify(forwarded)}`, async () => {
    const f = await fixture();
    try {
      const { token, cookie } = await exchange(f.backend.url.origin);
      const headers = new Headers({
        Cookie: cookie,
        Origin: f.backend.url.origin.replace("http:", "https:"),
      });
      for (const [name, value] of Object.entries(forwarded)) headers.set(name, value);
      const response = await fetch(new URL("/etf", f.backend.url), {
        method: "POST",
        headers,
        body: new URLSearchParams({ _token: token }),
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Cross-site cookie requests are not allowed.");
    } finally {
      await f.close();
    }
  });

test("direct same-origin HTTP remains valid, independent of APP_URL", async () => {
  const f = await fixture();
  try {
    const { token, cookie } = await exchange(f.backend.url.origin);
    const response = await fetch(new URL("/etf", f.backend.url), {
      method: "POST",
      headers: { Cookie: cookie, Origin: f.backend.url.origin },
      body: new URLSearchParams({ _token: token }),
    });
    expect(response.status).toBe(422);
  } finally {
    await f.close();
  }
});

test("native TLS remains valid without an adapter", async () => {
  const f = await fixture({ nativeTls: true });
  try {
    const { token, cookie } = await exchange(f.backend.url.origin);
    const response = await fetch(new URL("/etf", f.backend.url), {
      method: "POST",
      tls: { ca: cert },
      headers: { Cookie: cookie, Origin: f.backend.url.origin },
      body: new URLSearchParams({ _token: token }),
    });
    expect(response.status).toBe(422);
  } finally {
    await f.close();
  }
});

test("the app adapter does not authenticate the proxy: direct matching-host transport also passes", async () => {
  const f = await fixture({ adapter: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(new URL("/etf", f.backend.url), {
      method: "POST",
      headers: { Host: new URL(f.publicOrigin).host, Cookie: cookie, Origin: f.publicOrigin },
      body: new URLSearchParams({ _token: token }),
    });
    expect(response.status).toBe(422);
    expect(f.observations.at(-1)?.forwardedProto).toBeNull();
    expect(f.observations.at(-1)?.tokenValidHandlerReached).toBe(true);
  } finally {
    await f.close();
  }
});

test("a real browser sends Secure cookies and HTTPS Origin through the TLS-offload edge", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const boundary of ["default", "adapter", "target", "kernel"] as const) {
      const f = await fixture({
        adapter: boundary === "adapter",
        targetOrigin: boundary === "target",
        kernel: boundary === "kernel",
      });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        const page = await context.newPage();
        expect((await page.goto(`${f.publicOrigin}/etf`))?.status()).toBe(200);
        const cookies = await context.cookies(f.publicOrigin);
        expect(cookies).toHaveLength(1);
        expect(cookies[0]).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax" });
        const [response] = await Promise.all([
          page.waitForResponse((response) => response.request().method() === "POST"),
          page.getByRole("button", { name: "Submit" }).click(),
        ]);
        expect(response.status()).toBe(boundary === "default" ? 403 : 422);
        expect(f.observations.at(-1)).toMatchObject({
          protocol: "http:",
          browserOrigin: f.publicOrigin,
          forwardedProto: "https",
          tokenValidHandlerReached: boundary !== "default",
        });
      } finally {
        await context.close();
        await f.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("kernel target policy preserves native route params, original URL, body and request identity", async () => {
  const f = await fixture({ kernel: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(`${f.publicOrigin}/etf/na%C3%AFve?source=native`, {
      method: "POST",
      tls: { ca: cert },
      headers: { Cookie: cookie, Origin: f.publicOrigin },
      body: new URLSearchParams({ _token: token, email: "invalid" }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      email: "invalid",
      path: "/etf/na%C3%AFve",
      search: "?source=native",
      id: "naïve",
    });
    expect(f.observations.at(-1)).toMatchObject({
      requestIdentityPreserved: true,
      protocol: "http:",
      tokenValidHandlerReached: true,
    });
  } finally {
    await f.close();
  }
});

test("configured host admission rejects an unknown form GET before issuing a CSRF cookie", async () => {
  const f = await fixture({ kernel: true });
  try {
    const response = await fetch(`${f.publicOrigin}/etf`, {
      tls: { ca: cert },
      headers: {
        Host: "evil.example.test",
        "X-Forwarded-Host": new URL(f.publicOrigin).host,
        "X-Forwarded-Proto": "https",
      },
    });
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("configured target ignores forged forwarding claims on direct backend requests", async () => {
  const f = await fixture({ kernel: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(new URL("/etf", f.backend.url), {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: f.publicOrigin,
        "X-Forwarded-Host": new URL(f.publicOrigin).host,
        "X-Forwarded-Proto": "https",
      },
      body: new URLSearchParams({ _token: token, email: "invalid" }),
    });
    expect(response.status).toBe(403);
    expect(f.observations.at(-1)?.tokenValidHandlerReached).toBe(false);
  } finally {
    await f.close();
  }
});

test("explicit target is origin policy, not proxy authentication: valid direct virtual-host requests remain valid", async () => {
  const f = await fixture({ kernel: true });
  try {
    const { token, cookie } = await exchange(f.publicOrigin);
    const response = await fetch(new URL("/etf", f.backend.url), {
      method: "POST",
      headers: { Cookie: cookie, Host: new URL(f.publicOrigin).host, Origin: f.publicOrigin },
      body: new URLSearchParams({ _token: token, email: "invalid" }),
    });
    expect(response.status).toBe(422);
    expect(f.observations.at(-1)).toMatchObject({
      forwardedProto: null,
      requestIdentityPreserved: true,
      tokenValidHandlerReached: true,
    });
  } finally {
    await f.close();
  }
});

for (const kernel of [false, true]) {
  for (const suffix of ["/", "/path", "?query", "#fragment", "userinfo"]) {
    test(`${kernel ? "kernel" : "target"} rejects a URL-shaped non-origin over real proxy transport: ${suffix}`, async () => {
      const f = await fixture({ targetOrigin: true, kernel });
      try {
        const { token, cookie } = await exchange(f.publicOrigin);
        const origin =
          suffix === "userinfo"
            ? f.publicOrigin.replace("https://", "https://user@")
            : f.publicOrigin + suffix;
        const response = await fetch(`${f.publicOrigin}/etf`, {
          method: "POST",
          tls: { ca: cert },
          headers: { Cookie: cookie, Origin: origin },
          body: new URLSearchParams({ _token: token, email: "invalid" }),
        });
        expect(response.status).toBe(403);
        expect(f.observations.at(-1)?.tokenValidHandlerReached).toBe(false);
      } finally {
        await f.close();
      }
    });
  }
  test(`${kernel ? "kernel" : "target"} rejects malformed wire Host values without issuing cookies`, async () => {
    const f = await fixture({ targetOrigin: true, kernel });
    try {
      // A parseable conflicting authority reaches policy; invalid native URL
      // metadata is rejected at transport admission before application middleware.
      for (const [host, status] of [
        ["forms.example.test,evil.example.test", 403],
        ["user@forms.example.test", 400],
      ] as const) {
        const response = await fetch(new URL("/etf", f.backend.url), {
          headers: { Host: host },
        });
        expect(response.status).toBe(status);
        expect(response.headers.getSetCookie()).toHaveLength(0);
      }
    } finally {
      await f.close();
    }
  });
}
