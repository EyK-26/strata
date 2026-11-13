import { expect, test } from "bun:test";
import {
  createIntendedUrlCookie,
  intendedUrlCookieOptionsFromEnvironment,
} from "@getstrata/core/auth/intendedUrlCookie";
import { jwtOptionsFromEnvironment, signJwt, verifyJwt } from "@getstrata/core/auth/jwt";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
  passwordConfirmOptionsFromEnvironment,
} from "@getstrata/core/auth/passwordConfirmCookie";
import {
  createSessionCookie,
  readSession,
  sessionCookieOptionsFromEnvironment,
} from "@getstrata/core/auth/sessionCookie";
import {
  createCsrfTokenCookie,
  csrfTokenOptionsFromEnvironment,
  verifyCsrfToken,
} from "@getstrata/core/http/csrfToken";
import {
  createFlashCookie,
  flashSessionOptionsFromEnvironment,
  pullFlash,
} from "@getstrata/core/http/flashSession";
import { hasValidSignature, temporarySignedUrl } from "@getstrata/core/http/signedUrl";

function request(cookie: string) {
  return new Request("https://example.test/account", {
    headers: { cookie: cookie.split(";")[0] ?? "" },
  });
}
test("two applications keep cookie names, keys, flags and lifetimes when source environment changes", () => {
  const env = {
    APP_ENV: "production",
    APP_KEY_PREFIX: "app_a",
    SESSION_SECRET: "app-a-session-secret",
    SESSION_TTL_SECONDS: "120",
    PASSWORD_CONFIRM_TIMEOUT: "90",
    JWT_TTL_SECONDS: "60",
  };
  const sessionA = sessionCookieOptionsFromEnvironment(env),
    passwordA = passwordConfirmOptionsFromEnvironment(env),
    intendedA = intendedUrlCookieOptionsFromEnvironment(env),
    flashA = flashSessionOptionsFromEnvironment(env),
    csrfA = csrfTokenOptionsFromEnvironment(env),
    jwtA = jwtOptionsFromEnvironment(env);
  Object.assign(env, {
    APP_ENV: "local",
    APP_KEY_PREFIX: "app_b",
    SESSION_SECRET: "app-b-session-secret",
    SESSION_TTL_SECONDS: "900",
    PASSWORD_CONFIRM_TIMEOUT: "600",
    JWT_TTL_SECONDS: "600",
  });
  const sessionB = sessionCookieOptionsFromEnvironment(env),
    passwordB = passwordConfirmOptionsFromEnvironment(env),
    flashB = flashSessionOptionsFromEnvironment(env),
    csrfB = csrfTokenOptionsFromEnvironment(env),
    jwtB = jwtOptionsFromEnvironment(env);
  const session = createSessionCookie(7, { authVersion: 3 }, sessionA);
  expect(session).toContain("app_a_session=");
  expect(session).toContain("Max-Age=120; Secure");
  expect(readSession(request(session), sessionA)?.userId).toBe(7);
  expect(readSession(request(session), sessionB)).toBeNull();
  expect(
    readSession(request(session), { ...sessionB, cookieName: sessionA.cookieName }),
  ).toBeNull();
  const password = createPasswordConfirmCookie(7, 3, passwordA);
  expect(password).toContain("Max-Age=90; Secure");
  expect(hasFreshPasswordConfirmation(request(password), 7, 3, passwordA)).toBe(true);
  expect(
    hasFreshPasswordConfirmation(request(password), 7, 3, {
      ...passwordB,
      cookieName: passwordA.cookieName,
    }),
  ).toBe(false);
  expect(createIntendedUrlCookie("/account", intendedA)).toContain("app_a_intended=");
  const flash = createFlashCookie({ level: "info", message: "Owned by A" }, flashA);
  expect(pullFlash(request(flash), flashA)?.message).toBe("Owned by A");
  expect(pullFlash(request(flash), { ...flashB, cookieName: flashA.cookieName })).toBeNull();
  const csrf = createCsrfTokenCookie(csrfA);
  expect(verifyCsrfToken(request(csrf.cookie), csrf.token, csrfA)).toBe(true);
  expect(
    verifyCsrfToken(request(csrf.cookie), csrf.token, { ...csrfB, cookieName: csrfA.cookieName }),
  ).toBe(false);
  const jwt = signJwt({ sub: 7 }, jwtA);
  const payload = verifyJwt(jwt, jwtA.secret);
  if (typeof payload?.exp !== "number" || typeof payload.iat !== "number")
    throw new Error("Missing JWT lifetime");
  expect(payload.exp - Math.floor(payload.iat)).toBe(60);
  expect(verifyJwt(jwt, jwtB.secret)).toBeNull();
  const signed = temporarySignedUrl("/download", 60, {}, sessionA.secret);
  expect(hasValidSignature(signed, sessionA.secret)).toBe(true);
  expect(hasValidSignature(signed, sessionB.secret)).toBe(false);
});
