import { describe, expect, spyOn, test } from "bun:test";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";

const TEST_ADMIN_API_TOKEN = "strata-admin-test-token";

describe("assertProductionSecrets", () => {
  test("allows default tokens outside production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "local",
        ADMIN_API_TOKEN: TEST_ADMIN_API_TOKEN,
      }),
    ).not.toThrow();
  });

  test("blocks default tokens in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: TEST_ADMIN_API_TOKEN,
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        KMS_ENCRYPTION_KEY: "c".repeat(64),
      }),
    ).toThrow(/Production startup blocked/);
  });

  test("blocks production startup without KMS key when encryption is enabled", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "true",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
      }),
    ).toThrow(/KMS_ENCRYPTION_KEY/);
  });

  test("blocks AUTH_DEV_HEADERS in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "true",
      }),
    ).toThrow(/AUTH_DEV_HEADERS=false/);
  });

  test("runs when NODE_ENV=production even if APP_ENV is unset", () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: "production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "true",
      }),
    ).toThrow(/AUTH_DEV_HEADERS=false/);
  });

  test("runs when APP_ENV is Production or an unrecognized value", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "Production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "true",
      }),
    ).toThrow(/AUTH_DEV_HEADERS=false/);
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "prod",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "true",
      }),
    ).toThrow(/AUTH_DEV_HEADERS=false/);
  });

  test("still skips known non-production APP_ENV values", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "local",
        AUTH_DEV_HEADERS: "true",
        ADMIN_API_TOKEN: TEST_ADMIN_API_TOKEN,
      }),
    ).not.toThrow();
  });

  test("runs when APP_ENV is staging", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "staging",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "true",
      }),
    ).toThrow(/AUTH_DEV_HEADERS=false/);
  });

  test("blocks missing SAML_IDP_ISSUER when SAML is enabled in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_PUBLIC_READS: "false",
        FEATURE_SAML: "true",
        FRONTEND_MODE: "api",
        SAML_IDP_SSO_URL: "https://idp.example.test/sso",
        SAML_IDP_CERT: "cert",
        SAML_SP_ENTITY_ID: "https://sp.example.test/metadata",
        SAML_ACS_URL: "https://app.example/auth/saml/acs",
      }),
    ).toThrow(/SAML_IDP_ISSUER/);
  });

  test("blocks SAML_WANT_RESPONSE_SIGNED=false when SAML is enabled in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_PUBLIC_READS: "false",
        FEATURE_SAML: "true",
        FRONTEND_MODE: "api",
        OAUTH_STATE_SECRET: "rotated-oauth-state-secret",
        SAML_IDP_SSO_URL: "https://idp.example.test/sso",
        SAML_IDP_CERT: "cert",
        SAML_SP_ENTITY_ID: "https://sp.example.test/metadata",
        SAML_ACS_URL: "https://app.example/auth/saml/acs",
        SAML_IDP_ISSUER: "https://idp.example.test/metadata",
        SAML_WANT_RESPONSE_SIGNED: "false",
      }),
    ).toThrow(/signed SAML responses are required/);
  });

  test("blocks missing STRIPE_WEBHOOK_SECRET when billing is enabled in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "true",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
      }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  test("blocks wildcard CORS in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        CORS_ALLOWED_ORIGINS: "*",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
      }),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  test("blocks missing token expiry policy in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_PUBLIC_READS: "false",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        OAUTH_STATE_SECRET: "rotated-oauth-state-secret",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
      }),
    ).toThrow(/API_TOKEN_DEFAULT_EXPIRY_DAYS/);
  });

  test("blocks missing SESSION_SECRET when server-htmx is enabled in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_PUBLIC_READS: "false",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        OAUTH_STATE_SECRET: "rotated-oauth-state-secret",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
        FRONTEND_MODE: "server-htmx",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  test("allows production API mode without SESSION_SECRET", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_PUBLIC_READS: "false",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        OAUTH_STATE_SECRET: "rotated-oauth-state-secret",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
        FRONTEND_MODE: "api",
      }),
    ).not.toThrow();
  });

  test("does not require CORS or OAuth secrets just because API tokens exist", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        AUTH_DEV_HEADERS: "false",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
        FRONTEND_MODE: "api",
      }),
    ).not.toThrow();
  });

  test("allows a production HTMX app without published test tokens", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        FRONTEND_MODE: "server-htmx",
        AUTH_DEV_HEADERS: "false",
        DATABASE_URL: "postgres://localhost/getstrata",
        SESSION_SECRET: "a".repeat(32),
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_SCIM: "false",
        FEATURE_OAUTH: "false",
        FEATURE_PUBLIC_READS: "false",
      }),
    ).not.toThrow();
  });

  test("blocks a production HTMX sibling app without SESSION_SECRET", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        FRONTEND_MODE: "server-htmx",
        AUTH_DEV_HEADERS: "false",
        DATABASE_URL: "postgres://localhost/getstrata",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  test("requires SESSION_SECRET for hybrid staff HTML plus candidate SPA", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        FRONTEND_MODE: "hybrid",
        AUTH_DEV_HEADERS: "false",
        DATABASE_URL: "postgres://localhost/getstrata",
      }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        FRONTEND_MODE: "hybrid",
        AUTH_DEV_HEADERS: "false",
        DATABASE_URL: "postgres://localhost/getstrata",
        SESSION_SECRET: "a".repeat(32),
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_SCIM: "false",
        FEATURE_OAUTH: "false",
        FEATURE_PUBLIC_READS: "false",
      }),
    ).not.toThrow();
  });

  test("blocks public reads in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "false",
        FEATURE_FIELD_ENCRYPTION: "false",
        FEATURE_BILLING: "false",
        FEATURE_PUBLIC_READS: "true",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        OAUTH_STATE_SECRET: "rotated-oauth-state-secret",
        TOKEN_HASH_PEPPER: "rotated-token-pepper",
        API_TOKEN_DEFAULT_EXPIRY_DAYS: "90",
      }),
    ).toThrow(/FEATURE_PUBLIC_READS=false/);
  });

  test("blocks the generator's own placeholder secrets in production", () => {
    // These are long enough to pass the SESSION_SECRET length check, so before
    // 1.0.1 a generated .env booted in production unchanged.
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "false",
        FRONTEND_MODE: "server-htmx",
        FEATURE_PUBLIC_READS: "false",
        SESSION_SECRET: "dev-session-secret-change-me-please-32ch",
      }),
    ).toThrow(/replace the generated placeholder values for SESSION_SECRET/);
  });

  test("names every unrotated placeholder at once", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "false",
        FEATURE_PUBLIC_READS: "false",
        TOKEN_HASH_PEPPER: "dev-token-pepper-change-me",
        METRICS_TOKEN: "dev-metrics-token-change-me",
        SCIM_BEARER_TOKEN: "dev-scim-token-change-me",
      }),
    ).toThrow(/TOKEN_HASH_PEPPER, METRICS_TOKEN, SCIM_BEARER_TOKEN/);
  });

  test("allows placeholder secrets outside production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "local",
        SESSION_SECRET: "dev-session-secret-change-me-please-32ch",
      }),
    ).not.toThrow();
  });

  test("accepts rotated secrets of the same length", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
        APP_URL: "https://app.example",
        AUTH_DEV_HEADERS: "false",
        FRONTEND_MODE: "server-htmx",
        FEATURE_PUBLIC_READS: "false",
        SESSION_SECRET: "a-real-rotated-session-secret-value-32ch",
      }),
    ).not.toThrow();
  });
});

describe("assertProductionSecrets APP_URL", () => {
  const base = {
    APP_ENV: "production",
    AUTH_DEV_HEADERS: "false",
    FEATURE_PUBLIC_READS: "false",
    FRONTEND_MODE: "api",
  };

  test("blocks a missing, local, or malformed APP_URL", () => {
    for (const APP_URL of [
      undefined,
      "",
      "http://localhost:3000",
      "http://127.0.0.1",
      "not a url",
      "ftp://app.example",
    ]) {
      expect(() => assertProductionSecrets({ ...base, APP_URL })).toThrow(
        /set APP_URL to the public origin/,
      );
    }
  });

  test("accepts a public origin and only warns about plain http", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() =>
        assertProductionSecrets({ ...base, APP_URL: "https://app.example.com" }),
      ).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
      expect(() =>
        assertProductionSecrets({ ...base, APP_URL: "http://app.internal:8080/" }),
      ).not.toThrow();
      expect(String(warn.mock.calls[0]?.[0])).toContain("APP_URL uses http");
    } finally {
      warn.mockRestore();
    }
  });
});
