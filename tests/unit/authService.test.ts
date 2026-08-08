import { describe, expect, test, beforeAll } from "bun:test";
import { hashPassword, verifyPassword } from "../../src/core/auth/password";
import AuthService from "../../src/modules/user/authService";
import UserRepository from "../../src/modules/user/repository";
import ApiTokenRepository from "../../src/modules/user/apiTokenRepository";
import OAuthIdentityRepository from "../../src/modules/user/oauthIdentityRepository";
import TokenService from "../../src/modules/user/tokenService";
import { MockOAuthProvider } from "../../src/core/auth/oauth/providers";

beforeAll(async () => {
  const { freshDatabase } = await import("../../src/db/migrations/runner");
  await freshDatabase({ seed: true });
});

describe("password auth", () => {
  test("hashes and verifies passwords", async () => {
    const hash = await hashPassword("password");
    expect(await verifyPassword("password", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("logs in seeded users with email and password", async () => {
    const authService = new AuthService(
      new UserRepository(),
      new TokenService(new UserRepository(), new ApiTokenRepository()),
      new OAuthIdentityRepository(),
    );

    const created = await authService.loginWithPassword(
      "admin@workhub.test",
      "password",
    );

    expect(created.plainTextToken.length).toBeGreaterThan(20);
  });
});

describe("oauth auth", () => {
  test("creates a user from mock oauth callback", async () => {
    const authService = new AuthService(
      new UserRepository(),
      new TokenService(new UserRepository(), new ApiTokenRepository()),
      new OAuthIdentityRepository(),
    );

    authService.registerOAuthProvider(
      new MockOAuthProvider({
        providerUserId: "oauth-test-user",
        email: "oauth-user@workhub.test",
        name: "OAuth Test User",
      }),
    );

    const created = await authService.loginWithOAuth("mock", "valid-code");
    expect(created.plainTextToken.length).toBeGreaterThan(20);
  });
});
