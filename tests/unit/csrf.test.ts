import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import {
  createCsrfTokenCookie,
  resolveCsrfToken,
  verifyCsrfToken,
} from "@getstrata/core/http/csrfToken";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("csrfToken", () => {
  test("creates and verifies a csrf token", () => {
    const { token, cookie } = createCsrfTokenCookie();
    const request = new Request("http://example.test/organizations", {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });

    expect(verifyCsrfToken(request, token)).toBe(true);
    expect(verifyCsrfToken(request, "wrong-token")).toBe(false);
  });

  test("resolveCsrfToken reuses a valid cookie token", () => {
    const created = createCsrfTokenCookie();
    const request = new Request("http://example.test/", {
      headers: { cookie: created.cookie.split(";")[0] ?? "" },
    });

    expect(resolveCsrfToken(request).token).toBe(created.token);
  });

  test("marks the CSRF cookie Secure in production", () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";

    try {
      expect(createCsrfTokenCookie().cookie).toContain("; Secure");
    } finally {
      restoreEnvVar("APP_ENV", previous);
    }
  });
});

describe("createCsrfMiddleware", () => {
  test("allows safe methods and sets csrf cookie when needed", async () => {
    const middleware = createCsrfMiddleware();
    const response = await middleware(
      new Request("http://example.test/organizations"),
      async () => new Response("ok"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("workhub_csrf=");
  });

  test("rejects mutating requests without a csrf token", async () => {
    const middleware = createCsrfMiddleware();
    const { cookie } = createCsrfTokenCookie();

    await expect(
      middleware(
        new Request("http://example.test/organizations", {
          method: "POST",
          headers: { cookie: cookie.split(";")[0] ?? "" },
        }),
        async () => new Response("ok"),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  test("accepts mutating requests with matching form token", async () => {
    const middleware = createCsrfMiddleware();
    const { token, cookie } = createCsrfTokenCookie();
    const body = new URLSearchParams({ _token: token, name: "Acme" });

    const response = await middleware(
      new Request("http://example.test/organizations", {
        method: "POST",
        headers: {
          cookie: cookie.split(";")[0] ?? "",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      }),
      async () => new Response("created", { status: 302 }),
    );

    expect(response.status).toBe(302);
  });
});
