import { afterEach, describe, expect, test } from "bun:test";
import { secretsCheckCommand } from "../../../src/cli/commands/secretsCheck";

const envKeys = [
  "APP_ENV",
  "APP_URL",
  "SESSION_SECRET",
  "AUTH_DEV_HEADERS",
  "ADMIN_API_TOKEN",
  "MEMBER_API_TOKEN",
  "SCIM_BEARER_TOKEN",
  "KMS_ENCRYPTION_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CORS_ALLOWED_ORIGINS",
  "FEATURE_PUBLIC_READS",
  "OAUTH_STATE_SECRET",
  "TOKEN_HASH_PEPPER",
  "API_TOKEN_DEFAULT_EXPIRY_DAYS",
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "TENANCY_DRIVER",
] as const;

const previousEnv: Record<string, string | undefined> = {};

for (const key of envKeys) {
  previousEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousEnv[key];
    }
  }
});

describe("secretsCheckCommand", () => {
  test("passes when production secrets are configured", () => {
    process.env.APP_ENV = "production";
    process.env.APP_URL = "https://app.example.com";
    process.env.SESSION_SECRET = "rotated-session-secret-with-enough-length";
    process.env.AUTH_DEV_HEADERS = "false";
    process.env.ADMIN_API_TOKEN = "rotated-admin-token";
    process.env.MEMBER_API_TOKEN = "rotated-member-token";
    process.env.SCIM_BEARER_TOKEN = "rotated-scim-token";
    process.env.KMS_ENCRYPTION_KEY = "d".repeat(64);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
    process.env.FEATURE_PUBLIC_READS = "false";
    process.env.OAUTH_STATE_SECRET = "oauth-state-secret";
    process.env.TOKEN_HASH_PEPPER = "token-pepper";
    process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "90";
    process.env.TENANCY_DRIVER = "rls";
    process.env.DATABASE_URL = "postgresql://strata_app:rotated-app-secret@db.example/app";
    delete process.env.APP_DATABASE_URL;

    expect(() => secretsCheckCommand()).not.toThrow();
  });

  test("throws when production defaults remain", () => {
    process.env.ADMIN_API_TOKEN = "strata-admin-test-token";

    expect(() => secretsCheckCommand()).toThrow(/Production startup blocked/);
  });
});
