import { test } from "bun:test";
import assert from "node:assert/strict";
import { runWithAuthContext } from "@getstrata/core/auth/authContext";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import {
  clearPendingMfaCookie,
  createPendingMfaCookie,
  readPendingMfaCookie,
} from "@getstrata/core/auth/pendingMfaCookie";
import {
  createCsrfMiddleware,
  csrfMiddlewareOptionsFromEnvironment,
} from "@getstrata/core/http/csrfMiddleware";
import {
  createCsrfTokenCookie,
  csrfTokenOptionsFromEnvironment,
  resolveCsrfTokenForRequest,
  verifyCsrfToken,
  verifyCsrfTokenValue,
} from "@getstrata/core/http/csrfToken";
import { runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { absoluteTemporarySignedUrl, hasValidSignature } from "@getstrata/core/http/signedUrl";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";
import { createMetricsRoutes } from "../../src/bootstrap/metricsRoutes";
import { restoreEnvVar } from "../helpers/restoreEnv";

const cookieRequest = (header: string) =>
  new Request("https://one.test/account", {
    headers: { cookie: header.slice(0, header.indexOf(";")) },
  });

test("BP7 explicit per-app crypto options remain isolated after ambient secret and production changes", async () => {
  const keys = [
    "SESSION_SECRET",
    "OAUTH_STATE_SECRET",
    "SIGNED_URL_SECRET",
    "APP_URL",
    "NODE_ENV",
    "BUN_ENV",
    "APP_ENV",
    "METRICS_TOKEN",
    "AUTH_DEV_HEADERS",
    "CSRF_COOKIE_NAME",
    "SAML_ACS_URL",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const one = Object.freeze({ secret: "explicit-app-one-signing-key", production: true });
  const two = Object.freeze({ secret: "explicit-app-two-signing-key", production: false });
  const confirmOne = Object.freeze({ ...one, cookieName: "confirm_one", ttlSeconds: 90 });
  const confirmTwo = Object.freeze({ ...two, cookieName: "confirm_two", ttlSeconds: 120 });
  try {
    process.env.SESSION_SECRET = "unrelated-ambient-before";
    const oauth = createOAuthStateCookie(one);
    const confirm = createPasswordConfirmCookie(1, 3, confirmOne);
    const pending = createPendingMfaCookie(1, 3, one.secret, one.production);
    const signed = absoluteTemporarySignedUrl(
      "/verify",
      90,
      { account: 1 },
      "https://one.test",
      one.secret,
    );
    for (const key of keys)
      process.env[key] = key.endsWith("_ENV") ? "production" : "unrelated-ambient-after";
    process.env.APP_URL = "https://foreign.test";
    assert.equal(new URL(signed).origin, "https://one.test");
    assert.equal(hasValidSignature(signed, one.secret), true);
    assert.equal(hasValidSignature(signed, two.secret), false);
    assert.equal(verifyOAuthState(cookieRequest(oauth.cookie), oauth.state, one), true);
    assert.equal(verifyOAuthState(cookieRequest(oauth.cookie), oauth.state, two), false);
    assert.equal(hasFreshPasswordConfirmation(cookieRequest(confirm), 1, 3, confirmOne), true);
    assert.equal(
      hasFreshPasswordConfirmation(cookieRequest(confirm), 1, 3, {
        ...confirmOne,
        secret: two.secret,
      }),
      false,
    );
    assert.equal(hasFreshPasswordConfirmation(cookieRequest(confirm), 1, 3, confirmTwo), false);
    assert.deepEqual(readPendingMfaCookie(cookieRequest(pending), one.secret), {
      userId: 1,
      authVersion: 3,
    });
    assert.equal(readPendingMfaCookie(cookieRequest(pending), two.secret), null);
    const csrfOne = csrfTokenOptionsFromEnvironment({
      SESSION_SECRET: one.secret,
      CSRF_COOKIE_NAME: "csrf_one",
      NODE_ENV: "production",
    });
    const csrfTwo = csrfTokenOptionsFromEnvironment({
      SESSION_SECRET: two.secret,
      CSRF_COOKIE_NAME: "csrf_two",
      NODE_ENV: "development",
    });
    const issuedOne = createCsrfTokenCookie(csrfOne);
    const issuedTwo = createCsrfTokenCookie(csrfTwo);
    assert.match(issuedOne.cookie, /; Secure/);
    assert.doesNotMatch(issuedTwo.cookie, /; Secure/);
    const csrfRequest = (token: string, cookieName: string) =>
      new Request("https://one.test/account", {
        method: "POST",
        headers: {
          cookie: `${cookieName}=${encodeURIComponent(token)}`,
          "x-csrf-token": token,
          origin: "https://one.test",
        },
      });
    assert.equal(
      verifyCsrfToken(csrfRequest(issuedOne.token, csrfOne.cookieName), issuedOne.token, csrfOne),
      true,
    );
    assert.equal(
      verifyCsrfToken(csrfRequest(issuedOne.token, csrfTwo.cookieName), issuedOne.token, csrfTwo),
      false,
    );
    const middlewareOne = createCsrfMiddleware({
      ...csrfMiddlewareOptionsFromEnvironment(process.env),
      token: csrfOne,
      allowDevelopmentHeaders: true,
      samlAcsUrl: "https://one.test/explicit-acs",
    });
    const middlewareTwo = createCsrfMiddleware({
      ...csrfMiddlewareOptionsFromEnvironment(process.env),
      token: csrfTwo,
      allowDevelopmentHeaders: false,
    });
    process.env.SESSION_SECRET = "unrelated-after-csrf-capture";
    process.env.NODE_ENV = "development";
    process.env.BUN_ENV = "development";
    process.env.APP_ENV = "development";
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.SAML_ACS_URL = "https://one.test/account";
    assert.equal(
      (
        await middlewareOne(
          csrfRequest(issuedOne.token, csrfOne.cookieName),
          async () => new Response("one"),
        )
      ).status,
      200,
    );
    await assert.rejects(
      middlewareTwo(
        csrfRequest(issuedOne.token, csrfTwo.cookieName),
        async () => new Response("foreign token accepted"),
      ),
    );
    await assert.rejects(
      runWithAuthContext({ id: 1 }, "guest", () =>
        middlewareOne(
          new Request("https://one.test/account", {
            method: "POST",
            headers: { origin: "https://one.test" },
          }),
          async () => new Response("production guest bypass"),
        ),
      ) as Promise<Response>,
    );
    const publicRequest = new Request("https://two.test/form");
    await runWithRequestMeta(
      { ipAddress: null, userAgent: null, request: publicRequest, csrfToken: issuedOne.token },
      async () => {
        const token = resolveCsrfTokenForRequest(publicRequest, csrfTwo);
        assert.notEqual(
          token,
          issuedOne.token,
          "A foreign app metadata token must not be reused under explicit options",
        );
        assert.equal(verifyCsrfTokenValue(token, csrfTwo), true);
        const response = await middlewareTwo(publicRequest, async () => new Response("two form"));
        assert.equal(response.headers.getSetCookie().length, 1);
        assert.match(response.headers.getSetCookie()[0] ?? "", /^csrf_two=/);
      },
    );
    await runWithRequestMeta({ ipAddress: null, userAgent: null }, async () => {
      const request = new Request("https://two.test/nested");
      const response = await middlewareTwo(request, () =>
        middlewareTwo(request, async () =>
          Response.json({ token: resolveCsrfTokenForRequest(request, csrfTwo) }),
        ),
      );
      assert.equal(
        response.headers.getSetCookie().length,
        1,
        "Same-app nested GET still mints exactly one cookie",
      );
      const body = (await response.json()) as { token: string };
      assert.equal(verifyCsrfTokenValue(body.token, csrfTwo), true);
    });
    const metricsOne = createMetricsRoutes({
      authorization: { token: one.secret, production: true },
    });
    const metricsTwo = createMetricsRoutes({
      authorization: { token: two.secret, production: true },
    });
    process.env.METRICS_TOKEN = "foreign-ambient-metrics-token";
    const scrape = (token: string) =>
      new Request("https://one.test/metrics", { headers: { authorization: `Bearer ${token}` } });
    assert.equal((await metricsOne["/metrics"](scrape(one.secret))).status, 200);
    assert.equal((await metricsTwo["/metrics"](scrape(two.secret))).status, 200);
    assert.equal((await metricsOne["/metrics"](scrape(two.secret))).status, 404);
    assert.equal((await metricsTwo["/metrics"](scrape(one.secret))).status, 404);
    assert.equal(
      (await metricsOne["/metrics"](scrape("foreign-ambient-metrics-token"))).status,
      404,
    );
    const noSecret = createMetricsRoutes({ authorization: { production: true } });
    assert.equal(
      (await noSecret["/metrics"](scrape("foreign-ambient-metrics-token"))).status,
      404,
      "Explicit absent production secret cannot fall back to ambient credentials",
    );
    for (const header of [
      oauth.cookie,
      confirm,
      pending,
      clearOAuthStateCookie(one),
      clearPendingMfaCookie(true),
    ])
      assert.match(header, /; Secure/);
    for (const header of [
      createOAuthStateCookie(two).cookie,
      createPasswordConfirmCookie(2, 4, confirmTwo),
      createPendingMfaCookie(2, 4, two.secret, false),
      clearOAuthStateCookie(two),
      clearPendingMfaCookie(false),
    ])
      assert.doesNotMatch(header, /; Secure/);
  } finally {
    keys.forEach((key) => {
      restoreEnvVar(key, previous.get(key));
    });
  }
});
