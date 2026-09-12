import { afterEach, describe, expect, test } from "bun:test";
import {
  configureContentSecurityPolicy,
  HTMX_2_0_4_INDICATOR_STYLE_HASH,
  resetContentSecurityPolicyForTests,
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
    resetContentSecurityPolicyForTests();

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
    configureContentSecurityPolicy({
      directives: { "script-src": "https://cdn.jsdelivr.net" },
    });

    const policy = resolveHtmlContentSecurityPolicy();

    expect(policy).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(policy).toContain("frame-src https://www.youtube.com");
  });

  test("createSecurityHeadersMiddleware accepts a directives override", async () => {
    process.env.FRONTEND_MODE = "server-htmx";
    const middleware = createSecurityHeadersMiddleware({
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
    );

    expect(policy).toBe(serverHtmxContentSecurityPolicy());
    expect(policy).not.toContain("https://unpkg.com");
  });
});
