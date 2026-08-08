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
      }),
    ).toThrow(/Production startup blocked/);
  });
});
