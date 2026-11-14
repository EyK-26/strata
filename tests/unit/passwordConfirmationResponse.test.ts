import { expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import {
  createPasswordConfirmCookie,
  passwordConfirmOptionsFromEnvironment,
} from "@getstrata/core/auth/passwordConfirmCookie";
import {
  createSessionCookie,
  readSession,
  sessionCookieOptionsFromEnvironment,
} from "@getstrata/core/auth/sessionCookie";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { createRequirePasswordConfirmMiddleware } from "@getstrata/core/http/requirePasswordConfirmMiddleware";

for (const authenticated of [false, true]) {
  test(`explicit API password confirmation stays JSON for HTMX headers (authenticated=${authenticated})`, async () => {
    const response = await runWithRequestMeta(
      { ipAddress: null, userAgent: null, errorFormat: "json" },
      () =>
        runWithAuthUser(authenticated ? { id: 1, role: "member", authVersion: 0 } : null, () =>
          createRequirePasswordConfirmMiddleware(
            passwordConfirmOptionsFromEnvironment(process.env),
          )(
            new Request("http://example.test/api/v1/auth/mfa", {
              method: "POST",
              headers: { "HX-Request": "true", accept: "text/html" },
            }),
            async () => new Response("must not run"),
          ),
        ),
    );
    expect(response.status).toBe(authenticated ? 423 : 401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      error: authenticated ? "Password confirmation required." : "Authentication required.",
    });
  });
}

for (const authVersion of [undefined, 0]) {
  test(`a signed session cannot replace password confirmation (authVersion=${authVersion})`, async () => {
    const environment = {
      APP_ENV: "production",
      SESSION_SECRET: "shared-session-and-confirmation-regression-secret",
    };
    const sessionOptions = sessionCookieOptionsFromEnvironment(environment);
    const confirmationOptions = passwordConfirmOptionsFromEnvironment(environment);
    const sessionPair = createSessionCookie(7, { authVersion }, sessionOptions).split(";")[0] ?? "";
    const sessionValue = sessionPair.slice(sessionPair.indexOf("=") + 1);
    const request = new Request("https://example.test/account/export", {
      headers: {
        accept: "application/json",
        cookie: `${sessionPair}; ${confirmationOptions.cookieName}=${sessionValue}`,
      },
    });
    const session = readSession(request, sessionOptions);
    if (!session) throw new Error("Regression fixture must contain an authenticated session.");
    expect(session.userId).toBe(7);
    const requireConfirmation = createRequirePasswordConfirmMiddleware(confirmationOptions);
    const authenticate = (request: Request) =>
      runWithAuthUser({ id: session.userId, authVersion: session.authVersion }, () =>
        requireConfirmation(request, async () => new Response("protected export")),
      );

    const substituted = await authenticate(request);
    expect(substituted.status).toBe(423);
    expect(await substituted.json()).toEqual({ error: "Password confirmation required." });

    const confirmationPair =
      createPasswordConfirmCookie(7, authVersion, confirmationOptions).split(";")[0] ?? "";
    const confirmed = await authenticate(
      new Request(request.url, {
        headers: { accept: "application/json", cookie: `${sessionPair}; ${confirmationPair}` },
      }),
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.text()).toBe("protected export");

    const confirmationValue = confirmationPair.slice(confirmationPair.indexOf("=") + 1);
    expect(
      readSession(
        new Request(request.url, {
          headers: { cookie: `${sessionOptions.cookieName}=${confirmationValue}` },
        }),
        sessionOptions,
      ),
    ).toBeNull();
  });
}
