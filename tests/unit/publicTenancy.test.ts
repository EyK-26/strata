import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { createHttpKernel } from "@getstrata/bootstrap/httpKernel";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import {
  CORE_AUTH_TOKEN,
  CORE_PUBLIC_TENANCY_TOKEN,
  CORE_TENANT_RESOLVER_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import {
  createTenantMiddleware,
  normalizeTenantHostname,
} from "@getstrata/core/tenant/tenantMiddleware";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createMockDependencies } from "./testHelpers";

describe("trusted public tenancy", () => {
  const names = [
    "APP_ENV",
    "TENANCY_DRIVER",
    "TENANT_DEV_HEADERS",
    "FEATURE_PUBLIC_READS",
  ] as const;
  let previous: Array<string | undefined>;
  beforeEach(() => {
    previous = names.map((name) => process.env[name]);
    process.env.APP_ENV = "production";
    process.env.TENANCY_DRIVER = "column";
    process.env.TENANT_DEV_HEADERS = "false";
    process.env.FEATURE_PUBLIC_READS = "true";
  });
  afterEach(() =>
    names.forEach((name, index) => {
      restoreEnvVar(name, previous[index]);
    }),
  );

  const middleware = (proxies: readonly string[] = []) =>
    createTenantMiddleware({
      publicTenancy: {
        trustedProxyAddresses: proxies,
        resolveTenantId: async (host) =>
          host === "catalog.example" ? 7 : host === "other.example" ? 8 : null,
      },
      resolveTenant: async (id) => ({ id, slug: `tenant-${id}` }),
    });
  function request(host = "catalog.example", headers: Record<string, string> = {}) {
    return new Request("https://internal.example/catalog", { headers: { host, ...headers } });
  }
  async function run(req: Request, peerAddress?: string, proxies: readonly string[] = []) {
    return runWithRequestMeta({ ipAddress: "203.0.113.99", peerAddress, userAgent: null }, () =>
      middleware(proxies)(req, async () => Response.json({ tenant: currentTenant()?.id })),
    );
  }

  test("normalizes authority case, ports, terminal dots and IDNA consistently", () => {
    expect(normalizeTenantHostname("CATALOG.Example.:443")).toBe("catalog.example");
    expect(normalizeTenantHostname("bücher.example")).toBe("xn--bcher-kva.example");
    expect(normalizeTenantHostname("[::1]:8080")).toBe("[::1]");
    for (const host of [
      "",
      "a.example,b.example",
      "user@a.example",
      "a.example/path",
      "a.example\\path",
      "a..example",
      " a.example",
      "a.example:bad",
      "a.example#x",
      "a.example%2f.evil",
      `${"a".repeat(64)}.example`,
      "a".repeat(254),
    ]) {
      expect(() => normalizeTenantHostname(host)).toThrow("Invalid tenant hostname");
    }
  });
  test("resolves approved hosts and ignores guest tenant/header metadata", async () => {
    const response = await run(
      request("CATALOG.Example.:443", { "x-tenant-id": "8", "x-tenant-plan": "paid" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenant: 7 });
    expect(currentTenant()).toBeNull();
    expect((await run(new Request("https://catalog.example/catalog"))).status).toBe(200);
  });
  test("host validation also applies to authenticated requests without replacing account tenancy", async () => {
    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      expect((await run(request("unknown.example"))).status).toBe(403);
      const valid = await run(request("catalog.example"));
      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({ tenant: 1 });
    });
  });
  test("unknown hosts and absent production resolver fail before the handler", async () => {
    expect((await run(request("unknown.example", { "x-tenant-id": "7" }))).status).toBe(403);
    process.env.TENANT_DEV_HEADERS = "true";
    const response = await createTenantMiddleware({
      resolveTenant: async (id) => ({ id, slug: "x" }),
    })(request(), async () => new Response("unsafe"));
    expect(response.status).toBe(403);
  });
  test("forwarded hosts are used only for an allowlisted immediate socket peer", async () => {
    const req = request("unknown.example", {
      "x-forwarded-host": "catalog.example",
      "x-forwarded-for": "127.0.0.1",
    });
    expect((await run(req, "203.0.113.20", ["127.0.0.1"])).status).toBe(403);
    expect((await run(req, undefined, ["127.0.0.1"])).status).toBe(403);
    expect((await run(req, "127.0.0.1", ["127.0.0.1"])).status).toBe(200);
    expect(
      (
        await run(
          request("catalog.example", { "x-forwarded-host": "other.example" }),
          "203.0.113.20",
          ["127.0.0.1"],
        )
      ).status,
    ).toBe(200);
    const ipv6 = await run(req, "0:0:0:0:0:0:0:1", ["::1"]);
    expect(ipv6.status).toBe(200);
  });
  test("trusted proxy host lists/malformed authorities fail closed, without fallback", async () => {
    for (const host of ["catalog.example,other.example", "", "catalog.example/path"]) {
      expect(
        (
          await run(request("catalog.example", { "x-forwarded-host": host }), "127.0.0.1", [
            "127.0.0.1",
          ])
        ).status,
      ).toBe(403);
    }
    expect(() => middleware(["localhost"])).toThrow("literal IP");
    expect(() => middleware(Array(129).fill("127.0.0.1"))).toThrow("at most 128");
  });
  test("native JSON/HTML public reads use socket trust and explicit admission; private reads stay protected", async () => {
    process.env.FEATURE_PUBLIC_READS = "false";
    for (const trusted of [false, true]) {
      const container = new ServiceContainer();
      container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
      container.set(CORE_TENANT_RESOLVER_TOKEN, async (id) => ({ id, slug: `tenant-${id}` }));
      container.set(CORE_PUBLIC_TENANCY_TOKEN, {
        trustedProxyAddresses: trusted ? ["127.0.0.1", "::1"] : [],
        resolveTenantId: async (host) =>
          host === "catalog.example" ? 7 : host === "other.example" ? 8 : null,
      });
      const kernel = createHttpKernel(createMockDependencies(container));
      const handler = async () => Response.json({ tenant: currentTenant()?.id });
      const server = createWebServer({
        port: 0,
        routes: {
          "/catalog": {
            GET: withMiddleware(...kernel.globalMiddleware())(
              kernel.wrapPublicRead(handler, { allowAnonymous: true }),
            ),
          },
          "/web": {
            GET: withMiddleware(...kernel.globalMiddleware("web"))(
              kernel.wrapWebPublicRead(handler, { allowAnonymous: true }),
            ),
          },
          "/private": {
            GET: withMiddleware(...kernel.globalMiddleware())(
              kernel.wrapPublicRead(handler, { allowAnonymous: false }),
            ),
          },
        },
      });
      try {
        for (const path of ["/catalog", "/web"]) {
          const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
            headers: {
              host: "catalog.example",
              "x-forwarded-host": "other.example",
              "x-tenant-id": "999",
            },
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ tenant: trusted ? 8 : 7 });
        }
        expect(
          (
            await fetch(`http://127.0.0.1:${server.port}/catalog`, {
              headers: { host: "unknown.example" },
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(`http://127.0.0.1:${server.port}/private`, {
              headers: { host: "catalog.example" },
            })
          ).status,
        ).toBe(401);
      } finally {
        await server.stop(true);
        kernel.dispose();
      }
    }
  });
  test("a mapped identity must exist and resolver errors never select a default tenant", async () => {
    const missing = createTenantMiddleware({
      publicTenancy: { resolveTenantId: async () => 7 },
      resolveTenant: async () => null,
    });
    expect((await missing(request(), async () => new Response("unsafe"))).status).toBe(403);
    const invalid = createTenantMiddleware({ publicTenancy: { resolveTenantId: async () => -1 } });
    await expect(invalid(request(), async () => new Response("unsafe"))).rejects.toThrow(
      "invalid identity",
    );
    const failure = createTenantMiddleware({
      publicTenancy: {
        resolveTenantId: async () => {
          throw new Error("directory unavailable");
        },
      },
    });
    await expect(failure(request(), async () => new Response("unsafe"))).rejects.toThrow(
      "directory unavailable",
    );
  });
  test("public-read flags never enable development header selection", async () => {
    process.env.APP_ENV = "local";
    const local = createTenantMiddleware({ resolveTenant: async (id) => ({ id, slug: "local" }) });
    const execute = () =>
      local(request("catalog.example", { "x-tenant-id": "8" }), async () =>
        Response.json({ tenant: currentTenant()?.id }),
      );
    expect(await (await execute()).json()).toEqual({ tenant: 1 });
    process.env.TENANT_DEV_HEADERS = "true";
    expect(await (await execute()).json()).toEqual({ tenant: 8 });
    process.env.TENANT_DEV_HEADERS = "1";
    expect(await (await execute()).json()).toEqual({ tenant: 1 });
  });
});
