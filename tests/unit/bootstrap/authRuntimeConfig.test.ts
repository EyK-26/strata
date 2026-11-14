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

test("auth configuration exposes numeric expiry contracts for every enabled transport", () => {
  for (const token of [true, false]) {
    for (const jwt of [true, false]) {
      const config = createAuthRuntimeConfig(
        {
          environment: { API_TOKEN_DEFAULT_EXPIRY_DAYS: "7", JWT_TTL_SECONDS: "120" },
          production: false,
          jwtSecret: "secret",
        },
        { ...features, token, jwt },
      );
      // This assignment guards the published inferred return type as well as runtime values.
      const numeric: { tokenExpiryDays: number | null; jwtTtlSeconds: number } = config;
      expect(numeric.tokenExpiryDays).toBe(token ? 7 : null);
      expect(numeric.jwtTtlSeconds).toBe(jwt ? 120 : 3600);
    }
  }
});

test("disabled transports do not validate unrelated expiry variables", () => {
  const config = createAuthRuntimeConfig(
    {
      environment: { API_TOKEN_DEFAULT_EXPIRY_DAYS: "invalid", JWT_TTL_SECONDS: "invalid" },
      production: false,
      jwtSecret: "",
    },
    { ...features, token: false, jwt: false },
  );
  expect(config.tokenExpiryDays).toBeNull();
  expect(config.jwtTtlSeconds).toBe(3600);
});

test("enabled auth transports require explicit composition secrets", () => {
  expect(() =>
    createAuthRuntimeConfig({ environment: {}, production: false, jwtSecret: " " }, features),
  ).toThrow("JWT secret");
  expect(() =>
    createAuthRuntimeConfig(
      { environment: {}, production: false, jwtSecret: "secret" },
      { ...features, cookie: true },
    ),
  ).toThrow("SESSION_SECRET");
});

test("cookie runtime captures signed URL, OAuth, password confirmation, SAML and tenant options", () => {
  const environment = {
    APP_URL: "https://app.example.test/",
    APP_KEY_PREFIX: "acme",
    APP_NAME: "Acme",
    FEATURE_REGISTRATION: "true",
    FEATURE_SCIM: "true",
    FEATURE_SAML: "true",
    FEATURE_OAUTH: "true",
    TRUST_FORWARDED_FOR: "true",
    OIDC_ALLOW_PRIVATE: "true",
    SAML_IDP_SSO_URL: "https://idp.example.test/login",
    SAML_IDP_CERT: "certificate",
    SAML_SP_ENTITY_ID: "acme",
    SAML_ACS_URL: "https://app.example.test/saml/acs",
    SAML_IDP_ISSUER: "idp",
    SCIM_TENANT_TOKENS: "7:tenant-secret",
    PASSWORD_CONFIRM_TIMEOUT: "90",
    GITHUB_CLIENT_ID: "github-id",
    GITHUB_CLIENT_SECRET: "github-secret",
    GITHUB_REDIRECT_URI: "https://app.example.test/github",
    OIDC_ISSUER: "https://idp.example.test",
    OIDC_CLIENT_ID: "oidc-id",
    OIDC_CLIENT_SECRET: "oidc-secret",
    OIDC_REDIRECT_URI: "https://app.example.test/oidc",
  };
  const config = createAuthRuntimeConfig(
    {
      environment,
      production: true,
      jwtSecret: "jwt-secret",
      sessionSecret: "session-secret-for-runtime-tests",
    },
    { ...features, cookie: true, signedUrls: true },
  );
  environment.SCIM_TENANT_TOKENS = "9:replacement";
  expect(config.appUrl).toBe("https://app.example.test");
  expect(config.sessionCookie).toEqual({ cookieName: "acme_session", production: true });
  expect(config.signatureSecret).toBe("session-secret-for-runtime-tests");
  expect(config.oauth.secret).toBe(config.signatureSecret);
  expect(config.passwordConfirmation.ttlSeconds).toBe(90);
  expect(config.passwordConfirmation.cookieName).toBe("acme_password_confirmed");
  expect(config.saml?.spEntityId).toBe("acme");
  expect(config.scimTenantForToken("tenant-secret")).toBe(7);
  expect(config.scimTenantForToken("replacement")).toBeNull();
  expect(config.oidc.networkPolicy).toEqual({ production: true, allowPrivate: true });
});

test("explicit runtime security options are captured without sharing mutable confirmation settings", () => {
  const passwordConfirmation = {
    secret: "confirmation-secret",
    cookieName: "confirmed",
    ttlSeconds: 120,
    production: false,
  };
  const config = createAuthRuntimeConfig(
    {
      environment: {},
      production: false,
      jwtSecret: "jwt-secret",
      signatureSecret: "signature-secret",
      oauthStateSecret: "oauth-secret",
      passwordConfirmation,
    },
    features,
  );
  passwordConfirmation.ttlSeconds = 999;
  expect(config.signatureSecret).toBe("signature-secret");
  expect(config.oauth.secret).toBe("oauth-secret");
  expect(config.passwordConfirmation.ttlSeconds).toBe(120);
  expect(Object.isFrozen(config.passwordConfirmation)).toBe(true);
});
