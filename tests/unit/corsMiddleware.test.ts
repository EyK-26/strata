import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCorsMiddleware, resolveCorsConfig } from "@getstrata/core/http/corsMiddleware";

const previous = {
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
  CORS_ADDITIONAL_ALLOWED_HEADERS: process.env.CORS_ADDITIONAL_ALLOWED_HEADERS,
  APP_URL: process.env.APP_URL,
  APP_ENV: process.env.APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
};

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  delete process.env.CORS_ADDITIONAL_ALLOWED_HEADERS;
});

afterEach(() => {
  setEnv(previous);
});

async function run(origin: string | null, method = "GET"): Promise<Response> {
  const middleware = createCorsMiddleware();
  const request = new Request("http://app.test/api/things", {
    method,
    headers: origin ? { origin } : {},
  });
  return await middleware(request, async () => new Response("ok", { status: 200 }));
}

describe("createCorsMiddleware", () => {
  test("an unset allow list is APP_URL only and never *", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: undefined,
      APP_URL: "https://app.example",
      APP_ENV: "local",
      NODE_ENV: undefined,
    });
    expect(resolveCorsConfig().allowedOrigins).toEqual(["https://app.example"]);
    const allowed = await run("https://app.example");
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    const denied = await run("https://evil.example");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expect(denied.headers.get("vary")).toBe("Origin");
  });

  test("in production an unset allow list is still APP_URL only", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: undefined,
      APP_URL: "https://app.example",
      APP_ENV: "production",
      NODE_ENV: undefined,
    });
    expect(resolveCorsConfig().allowedOrigins).toEqual(["https://app.example"]);
    const response = await run("https://evil.example");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");

    const preflight = await run("https://evil.example", "OPTIONS");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an explicit allow list reflects only listed origins", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: "https://app.example, https://admin.example",
      APP_ENV: "production",
    });
    const allowed = await run("https://admin.example");
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://admin.example");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(allowed.headers.get("access-control-allow-headers")).toContain("X-CSRF-Token");
    expect(allowed.headers.get("access-control-max-age")).toBe("86400");

    const denied = await run("https://evil.example");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const noOrigin = await run(null);
    expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("preflight for a listed origin answers 204 with the CORS headers", async () => {
    setEnv({ CORS_ALLOWED_ORIGINS: "https://app.example", APP_ENV: "production" });
    const preflight = await run("https://app.example", "OPTIONS");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("does not send credentials when the allow list is *", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: "*",
      APP_ENV: "local",
    });
    const response = await run("https://app.example");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("application-approved CORS headers", () => {
  test("env extends defaults, deduplicates case-insensitively, and never reflects requested headers", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: "https://app.example",
      CORS_ADDITIONAL_ALLOWED_HEADERS:
        " Idempotency-Key, authorization, IDEMPOTENCY-KEY, X-Correlation-Id ",
    });
    const middleware = createCorsMiddleware();
    let calls = 0;
    const response = await middleware(
      new Request("http://api.example/orders", {
        method: "OPTIONS",
        headers: new Headers({
          Origin: "https://app.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,idempotency-key,x-unapproved",
        }),
      }),
      async () => {
        calls++;
        return new Response("not reached");
      },
    );
    const allowed =
      response.headers.get("access-control-allow-headers")?.toLowerCase().split(/,\s*/) ?? [];
    expect(response.status).toBe(204);
    expect(calls).toBe(0);
    expect(allowed.filter((name) => name === "authorization")).toHaveLength(1);
    expect(allowed.filter((name) => name === "idempotency-key")).toHaveLength(1);
    expect(allowed).toContain("content-type");
    expect(allowed).toContain("x-csrf-token");
    expect(allowed).toContain("x-correlation-id");
    expect(allowed).not.toContain("x-unapproved");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("typed options merge with env and cannot be mutated to widen the captured policy", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: "https://app.example",
      CORS_ADDITIONAL_ALLOWED_HEADERS: "X-From-Env",
    });
    const names = ["Idempotency-Key", "AUTHORIZATION"];
    const middleware = createCorsMiddleware({ additionalAllowedHeaders: names });
    names.push("X-Unapproved");
    const response = await middleware(
      new Request("http://api.example/orders", { headers: { Origin: "https://app.example" } }),
      async () =>
        new Response("body", { headers: { etag: "fixture", "content-type": "text/plain" } }),
    );
    const allowed = response.headers.get("access-control-allow-headers") ?? "";
    expect(allowed).toContain("Idempotency-Key");
    expect(allowed).toContain("X-From-Env");
    expect(allowed).not.toContain("X-Unapproved");
    expect(response.headers.get("etag")).toBe("fixture");
    expect(await response.text()).toBe("body");
  });

  test("additional headers do not authorize unknown, absent or null origins", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: "https://app.example",
      CORS_ADDITIONAL_ALLOWED_HEADERS: "Idempotency-Key",
    });
    for (const origin of ["https://evil.example", "null", null]) {
      const response = await run(origin, "OPTIONS");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("access-control-allow-headers")).toBeNull();
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
      expect(response.headers.get("vary")).toBe("Origin");
    }
  });

  test("an empty extra-header setting preserves defaults without granting wildcard credentials", async () => {
    setEnv({ CORS_ALLOWED_ORIGINS: "*", CORS_ADDITIONAL_ALLOWED_HEADERS: "  ", APP_ENV: "local" });
    expect(resolveCorsConfig().allowedHeaders).toEqual(
      resolveCorsConfig({ additionalAllowedHeaders: [] }).allowedHeaders,
    );
    expect(resolveCorsConfig().allowedHeaders).not.toContain("Idempotency-Key");
    const response = await run("https://any.example", "OPTIONS");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("invalid env names fail at middleware construction before admission", () => {
    for (const value of [
      "*",
      "X-Key,*",
      "X-Bad Header",
      "X-Key,",
      "X-Key,,X-Other",
      "X-Key:bad",
      "X-Key/Bad",
      "X-キー",
      "X-Key\r\nInjected: true",
    ]) {
      setEnv({ CORS_ADDITIONAL_ALLOWED_HEADERS: value });
      expect(() => createCorsMiddleware()).toThrow(TypeError);
    }
  });

  test("invalid options fail closed and all HTTP field-name token characters are accepted", () => {
    for (const value of [null, "X-Key", [1], [""], ["*"], [" X-Key "], ["X-Key\nBad"]]) {
      expect(() =>
        createCorsMiddleware({ additionalAllowedHeaders: value as unknown as readonly string[] }),
      ).toThrow(TypeError);
    }
    expect(
      resolveCorsConfig({ additionalAllowedHeaders: ["X-!#$%&'*+.^_`|~012"] }).allowedHeaders,
    ).toContain("X-!#$%&'*+.^_`|~012");
  });

  test("native HTTP preflight and application request preserve header and credential policy", async () => {
    setEnv({
      CORS_ALLOWED_ORIGINS: "https://app.example",
      CORS_ADDITIONAL_ALLOWED_HEADERS: "Idempotency-Key",
    });
    const middleware = createCorsMiddleware();
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        middleware(request, async () => {
          calls++;
          return Response.json({ key: request.headers.get("idempotency-key") });
        }),
    });
    try {
      const url = `http://localhost:${server.port}/orders`;
      const preflight = await fetch(url, {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,idempotency-key",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example");
      expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
        "idempotency-key",
      );
      expect(calls).toBe(0);
      const accepted = await fetch(url, {
        method: "POST",
        headers: new Headers({ origin: "https://app.example", "IDEMPOTENCY-KEY": "fixture-key" }),
      });
      expect(await accepted.json()).toEqual({ key: "fixture-key" });
      expect(accepted.headers.get("access-control-allow-credentials")).toBe("true");
      const rejected = await fetch(url, {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example",
          "access-control-request-headers": "idempotency-key",
        },
      });
      expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  });
});
