import { expect, test } from "bun:test";
import { createAuthRuntimeConfig } from "@getstrata/bootstrap/auth/runtimeConfig";
import { intendedUrlTtlSeconds } from "@getstrata/core/auth/intendedUrlCookie";
import { jwtOptionsFromEnvironment } from "@getstrata/core/auth/jwt";
import { passwordConfirmTtlSeconds } from "@getstrata/core/auth/passwordConfirmCookie";
import { sessionTtlSeconds } from "@getstrata/core/auth/sessionCookie";
import { resolveMaxUploadBytes } from "@getstrata/core/http/uploads";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";

const features = { users: true, cookie: false, token: true, jwt: true, signedUrls: false };
test("auth runtime snapshots feature policy and resolves documented blank defaults", () => {
  const environment = {
    FEATURE_REGISTRATION: "false",
    JWT_TTL_SECONDS: " ",
    API_TOKEN_DEFAULT_EXPIRY_DAYS: " ",
  };
  const config = createAuthRuntimeConfig(
    { environment, production: false, jwtSecret: "secret" },
    features,
  );
  environment.FEATURE_REGISTRATION = "true";
  expect(config.registrationEnabled).toBe(false);
  expect(config.jwtTtlSeconds).toBe(3600);
  expect(config.tokenExpiryDays).toBeNull();
  expect(Object.isFrozen(config)).toBe(true);
});
test.each(["12junk", "1.5", "1e3", "9007199254740992", "0"])(
  "integer environment consumers reject invalid explicit values: %s",
  (raw) => {
    const consumers = [
      () => jwtOptionsFromEnvironment({ JWT_SECRET: "secret", JWT_TTL_SECONDS: raw }),
      () => intendedUrlTtlSeconds({ INTENDED_URL_TTL_SECONDS: raw }),
      () => passwordConfirmTtlSeconds({ PASSWORD_CONFIRM_TIMEOUT: raw }),
      () => sessionTtlSeconds({ SESSION_TTL_SECONDS: raw }),
      () => resolveMaxUploadBytes(raw),
      () => resolveDefaultTokenExpiryDays(raw),
      () =>
        createAuthRuntimeConfig(
          { environment: { JWT_TTL_SECONDS: raw }, production: false, jwtSecret: "secret" },
          features,
        ),
    ];
    for (const consume of consumers) expect(consume).toThrow();
  },
);
