import { describe, expect, test } from "bun:test";
import { MockOAuthProvider } from "@getstrata/core/auth/oauth/providers";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { generateTotp } from "@getstrata/core/security/totp";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import ApiTokenRepository from "../../src/modules/user/apiTokenRepository";
import AuthService from "../../src/modules/user/authService";
import OAuthIdentityRepository from "../../src/modules/user/oauthIdentityRepository";
import UserRepository from "../../src/modules/user/repository";
import TokenService from "../../src/modules/user/tokenService";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { defaultTestTenant } from "./testHelpers";

describe("password auth", () => {
  test("hashes and verifies passwords", async () => {
    const hash = await hashPassword("password");
    expect(await verifyPassword("password", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("logs in seeded users with email and password", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const authService = new AuthService(
        new UserRepository(),
        new TokenService(new UserRepository(), new ApiTokenRepository()),
        new OAuthIdentityRepository(),
      );

      const created = await authService.loginWithPassword("admin@workhub.test", "password");

      expect(created.plainTextToken.length).toBeGreaterThan(20);
    });
  });

  test("session authentication does not create an API token", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const tokens = new TokenService(new UserRepository(), new ApiTokenRepository());
      const authService = new AuthService(
        new UserRepository(),
        tokens,
        new OAuthIdentityRepository(),
      );
      const before = await tokens.listTokensForUser(1);
      const user = await authService.authenticatePassword("admin@workhub.test", "password");
      const after = await tokens.listTokensForUser(1);

      expect(user.id).toBe(1);
      expect(after).toHaveLength(before.length);
    });
  });

  test("markEmailVerified stamps email_verified_at", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const authService = new AuthService(
        users,
        new TokenService(users, new ApiTokenRepository()),
        new OAuthIdentityRepository(),
      );

      await users.updateByIdOrThrow(1, { email_verified_at: null });
      const verified = await authService.markEmailVerified(1);

      expect(verified.email_verified_at).toBeInstanceOf(Date);
    });
  });

  test("MFA setup, login, and disable round-trip", async () => {
    const previousMfa = process.env.FEATURE_MFA;
    process.env.FEATURE_MFA = "true";

    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const authService = new AuthService(
        users,
        new TokenService(users, new ApiTokenRepository()),
        new OAuthIdentityRepository(),
      );

      try {
        const setup = await authService.beginMfaSetup(1);
        expect(setup.secret.length).toBeGreaterThan(10);
        expect(setup.otpauthUrl).toContain("otpauth://totp/");

        const code = generateTotp(setup.secret, Math.floor(Date.now() / 30_000));
        const enabled = await authService.confirmMfaSetup(1, code);
        expect(enabled.mfa_enabled).toBe(true);

        await expect(
          authService.authenticatePassword("admin@workhub.test", "password"),
        ).rejects.toThrow("Invalid MFA code.");

        const withCode = await authService.authenticatePassword("admin@workhub.test", "password", {
          mfaCode: generateTotp(setup.secret, Math.floor(Date.now() / 30_000)),
        });
        expect(withCode.id).toBe(1);

        const disabled = await authService.disableMfa(1, "password");
        expect(disabled.mfa_enabled).toBe(false);
      } finally {
        await users.updateByIdOrThrow(1, {
          mfa_enabled: false,
          mfa_secret: null,
          email_verified_at: new Date(),
        });
        restoreEnvVar("FEATURE_MFA", previousMfa);
      }
    });
  });
});

describe("oauth auth", () => {
  test("creates a user from mock oauth callback", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
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

  test("exposes registered oauth providers and authorization urls", () => {
    const authService = new AuthService(
      new UserRepository(),
      new TokenService(new UserRepository(), new ApiTokenRepository()),
      new OAuthIdentityRepository(),
    );
    const provider = new MockOAuthProvider({
      providerUserId: "oauth-test-user",
      email: "oauth-user@workhub.test",
      name: "OAuth Test User",
    });

    authService.registerOAuthProvider(provider);
    expect(authService.getOAuthProvider("mock")).toBe(provider);
    expect(authService.buildOAuthAuthorizationUrl("mock", "state-123")).toContain("state-123");
    expect(() => authService.buildOAuthAuthorizationUrl("missing", "state-123")).toThrow(
      "Unsupported OAuth provider.",
    );
  });
});
