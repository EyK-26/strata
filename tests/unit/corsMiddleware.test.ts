import { afterEach, describe, expect, test } from "bun:test";
import { createCorsMiddleware, resolveCorsConfig } from "@getstrata/core/http/corsMiddleware";

const previous = {
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
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
