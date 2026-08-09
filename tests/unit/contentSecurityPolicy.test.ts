import { afterEach, describe, expect, test } from "bun:test";
import {
  resolveContentSecurityPolicy,
  serverHtmxContentSecurityPolicy,
  strictApiContentSecurityPolicy,
} from "../../src/config/contentSecurityPolicy";

describe("resolveContentSecurityPolicy", () => {
  const previousMode = process.env.FRONTEND_MODE;

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.FRONTEND_MODE;
    } else {
      process.env.FRONTEND_MODE = previousMode;
    }
  });

  test("keeps strict CSP for JSON API responses", () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const policy = resolveContentSecurityPolicy(
      Response.json({ ok: true }, { headers: { "content-type": "application/json" } }),
    );

    expect(policy).toBe(strictApiContentSecurityPolicy());
  });

  test("relaxes CSP for HTML when server-htmx is enabled", () => {
    process.env.FRONTEND_MODE = "server-htmx";

    const policy = resolveContentSecurityPolicy(
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    );

    expect(policy).toBe(serverHtmxContentSecurityPolicy());
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("https://unpkg.com");
  });

  test("keeps strict CSP for HTML in api mode", () => {
    process.env.FRONTEND_MODE = "api";

    const policy = resolveContentSecurityPolicy(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );

    expect(policy).toBe(strictApiContentSecurityPolicy());
  });
});
