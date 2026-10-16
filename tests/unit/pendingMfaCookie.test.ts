import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { matchesAuthVersion } from "@getstrata/core/auth/accountState";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import {
  clearPendingMfaCookie,
  createPendingMfaCookie,
  readPendingMfaCookie,
} from "@getstrata/core/auth/pendingMfaCookie";

const original = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
const secret = "fixture-pending-mfa-secret-at-least-32-characters";
const request = (cookie: string) =>
  new Request("http://localhost/login/mfa", {
    headers: { cookie: cookie.split(";")[0] ?? cookie },
  });
function signed(payload: string) {
  return `strata_mfa_pending=${payload}.${createHmac("sha256", secret).update(`pending-mfa:${payload}`).digest("hex")}`;
}

test("pending MFA proof binds account version and expires without accepting legacy proofs", () => {
  process.env.APP_ENV = "local";
  const header = createPendingMfaCookie(3, 7, secret);
  expect(header).toContain("HttpOnly; SameSite=Lax; Max-Age=600");
  expect(readPendingMfaCookie(request(header), secret)).toEqual({ userId: 3, authVersion: 7 });
  expect(matchesAuthVersion(readPendingMfaCookie(request(header), secret)?.authVersion, 8)).toBe(
    false,
  );
  for (const value of [
    "",
    "strata_mfa_pending=3.1.old",
    "strata_mfa_pending=%E0%A4%A",
    header.replace("v1.3.7", "v1.4.7"),
    "strata_mfa_pending=v1.3.7.1.bad",
    signed(`v1.3.7.${Date.now() + 60000}`),
    signed(`v1.3.7.${Date.now() - 601000}`),
    signed(`v1.0.7.${Date.now()}`),
    signed(`v1.03.7.${Date.now()}`),
    signed(`v1.3.-1.${Date.now()}`),
    signed(`v1.9007199254740992.7.${Date.now()}`),
  ]) {
    expect(readPendingMfaCookie(request(value), secret)).toBeNull();
  }
  expect(clearPendingMfaCookie()).toContain("Max-Age=0");
  process.env.APP_ENV = "staging";
  expect(createPendingMfaCookie(3, 7, secret)).toContain("Secure");
  expect(clearPendingMfaCookie()).toContain("Secure");
  for (const version of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => createPendingMfaCookie(3, version, secret)).toThrow();
  expect(() => createPendingMfaCookie(0, 0, secret)).toThrow();
  expect(() => createPendingMfaCookie(1, 0, "")).toThrow();
});

test("password confirmation optionally binds the same account epoch and fails malformed cookies closed", () => {
  process.env.APP_ENV = "local";
  process.env.SESSION_SECRET = secret;
  const legacy = createPasswordConfirmCookie(3);
  const current = createPasswordConfirmCookie(3, 4);
  expect(hasFreshPasswordConfirmation(request(legacy), 3)).toBe(true);
  expect(hasFreshPasswordConfirmation(request(legacy), 3, 4)).toBe(false);
  expect(hasFreshPasswordConfirmation(request(current), 3, 4)).toBe(true);
  expect(hasFreshPasswordConfirmation(request(current), 3, 5)).toBe(false);
  expect(hasFreshPasswordConfirmation(request(current.replace(".4.", ".04.")), 3, 4)).toBe(false);
  expect(hasFreshPasswordConfirmation(request(`${legacy.split("=")[0]}=%E0%A4%A`), 3, 4)).toBe(
    false,
  );
  expect(() => createPasswordConfirmCookie(3, -1)).toThrow();
});
