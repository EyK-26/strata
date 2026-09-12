import { describe, expect, test } from "bun:test";
import { runWithAuthContext } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import {
  createCsrfTokenCookie,
  csrfCookieName,
  resolveCsrfToken,
  resolveCsrfTokenForRequest,
  verifyCsrfToken,
} from "@getstrata/core/http/csrfToken";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { appCookieName } from "@getstrata/core/runtime/appKeyPrefix";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("csrfToken", () => {
  test("creates and verifies a csrf token", () => {
    const { token, cookie } = createCsrfTokenCookie();
    const request = new Request("http://example.test/login", {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });

    expect(cookie).toContain("HttpOnly");
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
    const previousEnv = process.env.APP_ENV;
    const previousSecret = process.env.SESSION_SECRET;
    process.env.APP_ENV = "production";
    process.env.SESSION_SECRET = "production-csrf-secret-at-least-32-chars";

    try {
      expect(createCsrfTokenCookie().cookie).toContain("; Secure");
    } finally {
      restoreEnvVar("APP_ENV", previousEnv);
      restoreEnvVar("SESSION_SECRET", previousSecret);
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
    process.env.CSRF_COOKIE_NAME = "hiring_csrf";

    try {
      expect(csrfCookieName()).toBe("hiring_csrf");
      const created = createCsrfTokenCookie();
      expect(created.cookie).toContain("hiring_csrf=");
      expect(created.cookie).not.toContain(`${appCookieName("csrf")}=`);

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
      new Request("http://example.test/login"),
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
        new Request("http://example.test/login", {
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
      new Request("http://example.test/login", {
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

  test("skips CSRF only after bearer or basic authentication succeeds", async () => {
    const middleware = createCsrfMiddleware();
    const bearer = await runWithAuthContext({ id: 9 }, "bearer", () =>
      middleware(
        new Request("http://example.test/api/applications", {
          method: "POST",
          headers: { authorization: "Bearer hiring-token" },
        }),
        async () => new Response("ok"),
      ),
    );
    const basic = await runWithAuthContext({ id: 9 }, "basic", () =>
      middleware(
        new Request("http://example.test/api/applications", {
          method: "POST",
          headers: { authorization: `Basic ${Buffer.from("a:b").toString("base64")}` },
        }),
        async () => new Response("ok"),
      ),
    );

    expect(bearer.status).toBe(200);
    expect(basic.status).toBe(200);
  });

  test("skips CSRF on the SAML ACS callback path", async () => {
    const middleware = createCsrfMiddleware();
    const response = await middleware(
      new Request("http://example.test/auth/saml/acs", { method: "POST" }),
      async () => new Response("ok"),
    );
    expect(response.status).toBe(200);
  });

  test("skips CSRF on SCIM mutating paths that use their own bearer", async () => {
    const middleware = createCsrfMiddleware();
    const response = await middleware(
      new Request("http://example.test/scim/v2/Users", { method: "POST" }),
      async () => new Response("ok"),
    );
    expect(response.status).toBe(200);
  });

  test("skips CSRF on the configured SAML ACS pathname", async () => {
    const previous = process.env.SAML_ACS_URL;
    process.env.SAML_ACS_URL = "https://app.example.test/sso/acs";
    try {
      const middleware = createCsrfMiddleware();
      const response = await middleware(
        new Request("http://example.test/sso/acs", { method: "POST" }),
        async () => new Response("ok"),
      );
      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) {
        delete process.env.SAML_ACS_URL;
      } else {
        process.env.SAML_ACS_URL = previous;
      }
    }
  });

  test("treats an unparsable SAML ACS URL as the default path", async () => {
    const previous = process.env.SAML_ACS_URL;
    process.env.SAML_ACS_URL = "http://%";
    try {
      const middleware = createCsrfMiddleware();
      const response = await middleware(
        new Request("http://example.test/auth/saml/acs", { method: "POST" }),
        async () => new Response("ok"),
      );
      expect(response.status).toBe(200);
    } finally {
      if (previous === undefined) {
        delete process.env.SAML_ACS_URL;
      } else {
        process.env.SAML_ACS_URL = previous;
      }
    }
  });

  test("rejects guest mutating requests without a csrf token", async () => {
    const middleware = createCsrfMiddleware();
    await expect(
      middleware(
        new Request("http://example.test/api/v1/auth/login", { method: "POST" }),
        async () => new Response("ok"),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  test("accepts guest JSON mutating requests with a matching CSRF header", async () => {
    const middleware = createCsrfMiddleware();
    const { token, cookie } = createCsrfTokenCookie();
    const response = await middleware(
      new Request("http://example.test/api/v1/auth/login", {
        method: "POST",
        headers: {
          cookie: cookie.split(";")[0] ?? "",
          "x-csrf-token": token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "demo@example.com" }),
      }),
      async () => new Response("ok"),
    );
    expect(response.status).toBe(200);
  });

  test("requires a token after cookie login", async () => {
    const middleware = createCsrfMiddleware();
    await expect(
      runWithAuthContext({ id: 3 }, "session", () =>
        middleware(
          new Request("http://example.test/api/v1/auth/logout", { method: "POST" }),
          async () => new Response("ok"),
        ),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  test("nested GET CSRF reuses the first issued token instead of minting a second cookie", async () => {
    const middleware = createCsrfMiddleware();
    const request = new Request("http://example.test/api/v1/auth/csrf");
    const response = await runWithRequestMeta({ ipAddress: null, userAgent: null }, async () =>
      middleware(request, async () =>
        middleware(request, async () =>
          Response.json({ token: resolveCsrfTokenForRequest(request) }),
        ),
      ),
    );
    const cookies = response.headers.getSetCookie().filter((item) => item.includes("csrf="));
    expect(cookies).toHaveLength(1);
    const cookiePair = cookies[0]?.split(";")[0] ?? "";
    const cookieToken = decodeURIComponent(cookiePair.slice(cookiePair.indexOf("=") + 1));
    const body = (await response.json()) as { token: string };
    expect(body.token).toBe(cookieToken);
    expect(
      verifyCsrfToken(
        new Request("http://example.test/", { headers: { cookie: cookiePair } }),
        body.token,
      ),
    ).toBe(true);
  });

  test("does not skip CSRF for an unused Authorization header", async () => {
    const middleware = createCsrfMiddleware();

    await expect(
      runWithAuthContext(null, null, () =>
        middleware(
          new Request("http://example.test/login", {
            method: "POST",
            headers: { authorization: "Bearer garbage" },
          }),
          async () => new Response("ok"),
        ),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});
