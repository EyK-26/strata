import { describe, expect, test } from "bun:test";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import { TEST_ADMIN_API_TOKEN } from "../../src/domain/auth";

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
