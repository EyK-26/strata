import { afterEach, describe, expect, test } from "bun:test";
import {
  HTMX_2_0_4_INDICATOR_STYLE_HASH,
  resolveContentSecurityPolicy,
  resolveHtmlContentSecurityPolicy,
  serverHtmxContentSecurityPolicy,
  strictApiContentSecurityPolicy,
} from "@getstrata/core/http/contentSecurityPolicy";
import { createSecurityHeadersMiddleware } from "@getstrata/core/http/securityHeadersMiddleware";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("resolveContentSecurityPolicy", () => {
  const previousMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      restoreEnvVar("FRONTEND_MODE", previousMode);
    }
  });

  test("keeps strict CSP for JSON API responses", () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const policy = resolveContentSecurityPolicy(
      Response.json({ ok: true }, { headers: { "content-type": "application/json" } }),
    );

    expect(policy).toBe(strictApiContentSecurityPolicy());
    expect(policy).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  });

  test("relaxes CSP for HTML when server-htmx is enabled", () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const policy = resolveContentSecurityPolicy(
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      { frontendMode: process.env.FRONTEND_MODE as "server-htmx" | "hybrid" },
    );

    expect(policy).toBe(serverHtmxContentSecurityPolicy());
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain(HTMX_2_0_4_INDICATOR_STYLE_HASH);
    expect(policy).not.toContain("https://unpkg.com");
    expect(policy).toContain(
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    );
    expect(policy).toContain("media-src 'self' https:");
    expect(policy).toContain("img-src 'self' data: https:");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  test("apps can extend the HTMX baseline with one extra script host", () => {
    process.env.FRONTEND_MODE = "server-htmx";
    const policy = resolveHtmlContentSecurityPolicy({
      frontendMode: "server-htmx",
      directives: { "script-src": "https://cdn.jsdelivr.net" },
    });

    expect(policy).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(policy).toContain("frame-src https://www.youtube.com");
  });

  test("createSecurityHeadersMiddleware accepts a directives override", async () => {
    process.env.FRONTEND_MODE = "server-htmx";
    const middleware = createSecurityHeadersMiddleware({
      frontendMode: "server-htmx",
      directives: { "script-src": ["https://cdn.example.com"] },
    });

    const response = await middleware(
      new Request("http://example.test/learn"),
      async () =>
        new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const policy = response.headers.get("content-security-policy") ?? "";

    expect(policy).toContain("https://cdn.example.com");
    expect(policy).not.toContain("https://unpkg.com");
    expect(policy).toMatch(/'nonce-[^']+'/);
    expect(policy).not.toContain("'unsafe-inline'");
  });

  test("keeps strict CSP for HTML in api mode", () => {
    process.env.FRONTEND_MODE = "api";

    const policy = resolveContentSecurityPolicy(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );

    expect(policy).toBe(strictApiContentSecurityPolicy());
  });

  test("uses the HTMX CSP baseline in hybrid mode", () => {
    process.env.FRONTEND_MODE = "hybrid";

    const policy = resolveContentSecurityPolicy(
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      { frontendMode: process.env.FRONTEND_MODE as "server-htmx" | "hybrid" },
    );

    expect(policy).toBe(serverHtmxContentSecurityPolicy());
    expect(policy).not.toContain("https://unpkg.com");
  });
});

test("security headers retain the owner's CSP and production policy across caller and environment mutation", async () => {
  const directives = { "script-src": ["https://a-cdn.test"] };
  const options = { frontendMode: "server-htmx" as const, production: true, directives };
  const a = createSecurityHeadersMiddleware(options);
  const b = createSecurityHeadersMiddleware({
    frontendMode: "spa-react",
    production: false,
    csp: "default-src https://b.test",
  });
  const saved = {
    FRONTEND_MODE: process.env.FRONTEND_MODE,
    APP_ENV: process.env.APP_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };
  try {
    options.production = false;
    directives["script-src"].push("https://mutated.test");
    process.env.FRONTEND_MODE = "api";
    process.env.APP_ENV = "local";
    process.env.NODE_ENV = "production";
    const render = async () =>
      new Response("<p>ok</p>", { headers: { "content-type": "text/html" } });
    const first = await a(new Request("https://a.test"), render);
    const second = await b(new Request("https://b.test"), render);
    expect(first.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(second.headers.get("strict-transport-security")).toBeNull();
    expect(first.headers.get("content-security-policy")).toContain("https://a-cdn.test");
    expect(first.headers.get("content-security-policy")).not.toContain("mutated.test");
    expect(first.headers.get("content-security-policy")).toContain(HTMX_2_0_4_INDICATOR_STYLE_HASH);
    expect(second.headers.get("content-security-policy")).toBe("default-src https://b.test");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("explicit CSP directives preserve removal, nonce, alias and non-HTML restrictions", () => {
  const html = new Response("ok", { headers: { "content-type": "text/html" } });
  const custom = resolveContentSecurityPolicy(html, {
    frontendMode: "spa-react",
    directives: {
      "script-src": ["https://a.test https://b.test", "https://a.test"],
      "frame-ancestors": false,
      sandbox: "",
    },
  });
  expect(custom).toContain("script-src 'self' https://a.test https://b.test");
  expect(custom).not.toContain("frame-ancestors");
  expect(custom).toContain("sandbox");
  expect(resolveHtmlContentSecurityPolicy({ htmlCsp: "default-src https://alias.test" })).toBe(
    "default-src https://alias.test",
  );
  expect(resolveContentSecurityPolicy(Response.json({}), { csp: "default-src *" })).toBe(
    strictApiContentSecurityPolicy(),
  );
});
