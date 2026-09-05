import { describe, expect, test } from "bun:test";
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
        ADMIN_API_TOKEN: "rotated-admin-token",
        MEMBER_API_TOKEN: "rotated-member-token",
        SCIM_BEARER_TOKEN: "rotated-scim-token",
        AUTH_DEV_HEADERS: "true",
      }),
    ).toThrow(/AUTH_DEV_HEADERS=false/);
  });

  test("blocks missing STRIPE_WEBHOOK_SECRET when billing is enabled in production", () => {
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
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
        FRONTEND_MODE: "hybrid",
        AUTH_DEV_HEADERS: "false",
        DATABASE_URL: "postgres://localhost/getstrata",
      }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      assertProductionSecrets({
        APP_ENV: "production",
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
});
