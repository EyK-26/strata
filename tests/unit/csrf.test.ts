import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import {
  createCsrfTokenCookie,
  csrfCookieName,
  resolveCsrfToken,
  verifyCsrfToken,
} from "@getstrata/core/http/csrfToken";
import { appCookieName } from "@getstrata/core/runtime/appKeyPrefix";
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

  test("defaults to the namespaced CSRF cookie", () => {
    const previous = process.env.CSRF_COOKIE_NAME;
    delete process.env.CSRF_COOKIE_NAME;

    try {
      expect(csrfCookieName()).toBe(appCookieName("csrf"));
      expect(createCsrfTokenCookie().cookie).toContain(`${appCookieName("csrf")}=`);
    } finally {
      restoreEnvVar("CSRF_COOKIE_NAME", previous);
    }
  });

  test("overrides the CSRF cookie name from CSRF_COOKIE_NAME", () => {
    const previous = process.env.CSRF_COOKIE_NAME;
    process.env.CSRF_COOKIE_NAME = "strata_csrf";

    try {
      expect(csrfCookieName()).toBe("strata_csrf");
      const created = createCsrfTokenCookie();
      expect(created.cookie).toContain("strata_csrf=");
      expect(created.cookie).not.toContain("strata_csrf=");

      const request = new Request("http://example.test/", {
        headers: { cookie: created.cookie.split(";")[0] ?? "" },
      });
      expect(verifyCsrfToken(request, created.token)).toBe(true);
    } finally {
      restoreEnvVar("CSRF_COOKIE_NAME", previous);
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
    expect(response.headers.get("set-cookie")).toContain(`${appCookieName("csrf")}=`);
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

  test("skips CSRF when the request uses a bearer or basic credential", async () => {
    const middleware = createCsrfMiddleware();
    const bearer = await middleware(
      new Request("http://example.test/api/applications", {
        method: "POST",
        headers: { authorization: "Bearer hiring-token" },
      }),
      async () => new Response("ok"),
    );
    const basic = await middleware(
      new Request("http://example.test/api/applications", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from("a:b").toString("base64")}` },
      }),
      async () => new Response("ok"),
    );

    expect(bearer.status).toBe(200);
    expect(basic.status).toBe(200);
  });
});
