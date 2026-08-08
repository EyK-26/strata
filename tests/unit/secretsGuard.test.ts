import { describe, expect, test } from "bun:test";
import { assertProductionSecrets } from "../../src/bootstrap/secretsGuard";
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
        FEATURE_FIELD_ENCRYPTION: "true",
      }),
    ).toThrow(/KMS_ENCRYPTION_KEY/);
  });
});
