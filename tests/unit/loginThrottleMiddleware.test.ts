import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMemoryLoginThrottleMiddleware,
  resetMemoryLoginThrottleForTests,
  resolveLoginEmail,
} from "@getstrata/core/http/loginThrottleMiddleware";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";

const repoRoot = join(import.meta.dir, "../..");

function jsonLogin(email?: string): Request {
  return new Request("http://example.test/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: email === undefined ? JSON.stringify({}) : JSON.stringify({ email, password: "secret" }),
  });
}

describe("resolveLoginEmail", () => {
  test("trims and lowercases JSON and form email and clones so the handler can still read the body", async () => {
    const json = jsonLogin(" Demo@Example.COM ");
    await expect(resolveLoginEmail(json)).resolves.toBe("demo@example.com");
    expect(await json.json()).toEqual({ email: " Demo@Example.COM ", password: "secret" });

    const form = new Request("http://example.test/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=Demo@Example.COM&password=secret",
    });
    await expect(resolveLoginEmail(form)).resolves.toBe("demo@example.com");
    expect(await form.formData().then((data) => data.get("email"))).toBe("Demo@Example.COM");
  });

  test("missing or invalid JSON body is unknown, not a skip", async () => {
    await expect(resolveLoginEmail(jsonLogin())).resolves.toBe("unknown");
    const invalid = new Request("http://example.test/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    await expect(resolveLoginEmail(invalid)).resolves.toBe("unknown");
  });
});

describe("createMemoryLoginThrottleMiddleware", () => {
  afterEach(() => {
    resetMemoryLoginThrottleForTests();
  });

  test("same IP and email share a bucket; a missing-body unknown bucket does not lock out that email", async () => {
    const middleware = createMemoryLoginThrottleMiddleware({
      maxAttempts: 1,
      decaySeconds: 60,
      keyPrefix: "test-login-email:",
    });
    const next = async () => Response.json({ ok: true });

    await runWithRequestMeta({ ipAddress: "203.0.113.40", userAgent: null }, async () => {
      expect((await middleware(jsonLogin(), next)).status).toBe(200);
      expect((await middleware(jsonLogin("demo@example.com"), next)).status).toBe(200);
      expect((await middleware(jsonLogin("demo@example.com"), next)).status).toBe(429);
      expect((await middleware(jsonLogin("other@example.com"), next)).status).toBe(200);
      expect((await middleware(jsonLogin(), next)).status).toBe(429);
    });
  });
});

describe("wrapLogin wiring", () => {
  test("HiroApp JSON login and JWT mint call wrapLogin", async () => {
    const auth = await readFile(join(repoRoot, "apps/hiroapp/src/modules/auth/index.ts"), "utf8");
    expect(auth).toMatch(/"\/api\/v1\/auth\/login":[\s\S]*?wrapLogin\(/);
    expect(auth).toMatch(/"\/api\/auth\/token":[\s\S]*?wrapLogin\(/);
  });

  test("generated renderAuthFlows emits wrapLogin on JSON login and JWT mint", async () => {
    const rendered = await readFile(
      join(repoRoot, "packages/strata-starter/src/renderAuthFlows.ts"),
      "utf8",
    );
    expect(rendered).toMatch(/"\/api\/v1\/auth\/login":[\s\S]*?wrapLogin\(/);
    expect(rendered).toMatch(/"\/api\/auth\/token":[\s\S]*?wrapLogin\(/);
  });
});
