import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { MockOAuthProvider } from "@getstrata/core/auth/oauth/providers";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
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

  test("registerWithPassword creates a member without an API token", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const tokens = new TokenService(users, new ApiTokenRepository());
      const authService = new AuthService(users, tokens, new OAuthIdentityRepository());
      const email = `register-${Date.now()}@workhub.test`;

      const user = await authService.registerWithPassword("Ada Lovelace", email, "password123");
      const tokenList = await tokens.listTokensForUser(user.id);

      expect(user.email).toBe(email);
      expect(user.role).toBe("member");
      expect(user.email_verified_at).toBeInstanceOf(Date);
      expect(tokenList).toHaveLength(0);
      await expect(authService.authenticatePassword(email, "password123")).resolves.toMatchObject({
        id: user.id,
      });
    });
  });

  test("registerWithPassword rejects a duplicate email", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const authService = new AuthService(
        new UserRepository(),
        new TokenService(new UserRepository(), new ApiTokenRepository()),
        new OAuthIdentityRepository(),
      );

      await expect(
        authService.registerWithPassword("Admin", "admin@workhub.test", "password123"),
      ).rejects.toThrow("An account with this email already exists.");
    });
  });

  test("registerWithPassword leaves email unverified when verification is required", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const authService = new AuthService(
          new UserRepository(),
          new TokenService(new UserRepository(), new ApiTokenRepository()),
          new OAuthIdentityRepository(),
        );
        const email = `unverified-${Date.now()}@workhub.test`;
        const user = await authService.registerWithPassword("Unverified", email, "password123");

        expect(user.email_verified_at).toBeNull();
      });
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
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

  test("updateProfile changes name and keeps the same email", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const authService = new AuthService(
        users,
        new TokenService(users, new ApiTokenRepository()),
        new OAuthIdentityRepository(),
      );
      const email = `profile-name-${Date.now()}@workhub.test`;
      const created = await users.create({
        name: "Before Name",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        email_verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await authService.updateProfile(
        created.id,
        "  After Name  ",
        email.toUpperCase(),
      );

      expect(result.emailChanged).toBe(false);
      expect(result.user.name).toBe("After Name");
      expect(result.user.email).toBe(email);
      expect(result.user.email_verified_at).toBeInstanceOf(Date);
    });
  });

  test("updateProfile rejects a duplicate email", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const authService = new AuthService(
        users,
        new TokenService(users, new ApiTokenRepository()),
        new OAuthIdentityRepository(),
      );
      const email = `profile-dup-${Date.now()}@workhub.test`;
      const created = await users.create({
        name: "Dup Candidate",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        created_at: new Date(),
        updated_at: new Date(),
      });

      await expect(
        authService.updateProfile(created.id, "Dup Candidate", "admin@workhub.test"),
      ).rejects.toThrow("An account with this email already exists.");
      expect((await users.findByIdOrThrow(created.id)).email).toBe(email);
    });
  });

  test("updateProfile clears verification when the email changes and the flag is on", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const authService = new AuthService(
          users,
          new TokenService(users, new ApiTokenRepository()),
          new OAuthIdentityRepository(),
        );
        const email = `profile-verify-on-${Date.now()}@workhub.test`;
        const created = await users.create({
          name: "Verify On",
          email,
          role: "member",
          tenant_id: defaultTestTenant.id,
          password_hash: await hashPassword("password"),
          email_verified_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        });
        const nextEmail = `profile-verify-on-next-${Date.now()}@workhub.test`;

        const result = await authService.updateProfile(created.id, "Verify On", nextEmail);

        expect(result.emailChanged).toBe(true);
        expect(result.user.email).toBe(nextEmail);
        expect(result.user.email_verified_at).toBeNull();
      });
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("updateProfile keeps or stamps verification when the email changes and the flag is off", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "false";

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        const users = new UserRepository();
        const authService = new AuthService(
          users,
          new TokenService(users, new ApiTokenRepository()),
          new OAuthIdentityRepository(),
        );
        const verifiedEmail = `profile-verify-off-${Date.now()}@workhub.test`;
        const verifiedAt = new Date("2024-01-15T12:00:00.000Z");
        const verified = await users.create({
          name: "Verify Off",
          email: verifiedEmail,
          role: "member",
          tenant_id: defaultTestTenant.id,
          password_hash: await hashPassword("password"),
          email_verified_at: verifiedAt,
          created_at: new Date(),
          updated_at: new Date(),
        });
        const nextVerifiedEmail = `profile-verify-off-next-${Date.now()}@workhub.test`;
        const kept = await authService.updateProfile(verified.id, "Verify Off", nextVerifiedEmail);

        expect(kept.emailChanged).toBe(true);
        expect(kept.user.email).toBe(nextVerifiedEmail);
        expect(kept.user.email_verified_at?.getTime()).toBe(verifiedAt.getTime());

        const unverifiedEmail = `profile-verify-stamp-${Date.now()}@workhub.test`;
        const unverified = await users.create({
          name: "Stamp Verify",
          email: unverifiedEmail,
          role: "member",
          tenant_id: defaultTestTenant.id,
          password_hash: await hashPassword("password"),
          email_verified_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        });
        const stamped = await authService.updateProfile(
          unverified.id,
          "Stamp Verify",
          `profile-verify-stamp-next-${Date.now()}@workhub.test`,
        );

        expect(stamped.emailChanged).toBe(true);
        expect(stamped.user.email_verified_at).toBeInstanceOf(Date);
      });
    } finally {
      restoreEnvVar("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("changePassword updates a hash and rejects the old password", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const tokens = new TokenService(users, new ApiTokenRepository());
      const authService = new AuthService(users, tokens, new OAuthIdentityRepository());
      const email = `pw-change-${Date.now()}@workhub.test`;
      const created = await users.create({
        name: "Password Change User",
        email,
        role: "member",
        tenant_id: defaultTestTenant.id,
        password_hash: await hashPassword("password"),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const oauthOnly = await users.create({
        name: "OAuth Only",
        email: `oauth-only-${Date.now()}@workhub.test`,
        role: "member",
        tenant_id: defaultTestTenant.id,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await expect(authService.confirmCurrentPassword(oauthOnly.id, "password")).rejects.toThrow(
        "Invalid credentials.",
      );

      await authService.confirmCurrentPassword(created.id, "password");
      await expect(authService.confirmCurrentPassword(created.id, "wrong-pass")).rejects.toThrow(
        "Invalid credentials.",
      );
      await expect(
        authService.changePassword(created.id, "wrong-pass", "new-member-pass"),
      ).rejects.toThrow("Invalid credentials.");
      await expect(authService.changePassword(created.id, "password", "password")).rejects.toThrow(
        "Choose a different password.",
      );
      const keep = await tokens.createToken(created.id, { name: "keep" });
      const drop = await tokens.createToken(created.id, { name: "drop" });
      await runWithAuthUser(
        { id: created.id, role: "member", tokenId: keep.token.id },
        async () => {
          expect(await authService.logoutOtherDevices(created.id, "password")).toBe(1);
        },
      );
      expect(await tokens.resolveUserFromToken(keep.plainTextToken)).toMatchObject({
        id: created.id,
      });
      expect(await tokens.resolveUserFromToken(drop.plainTextToken)).toBeNull();
      const afterLogout = await users.findById(created.id);
      expect(afterLogout?.session_valid_after).toBeInstanceOf(Date);

      const extra = await tokens.createToken(created.id, { name: "extra" });
      await runWithAuthUser({ id: created.id, role: "member", tokenId: 0 }, async () => {
        await authService.changePassword(created.id, "password", "new-member-pass");
      });
      expect(await tokens.resolveUserFromToken(keep.plainTextToken)).toBeNull();
      expect(await tokens.resolveUserFromToken(extra.plainTextToken)).toBeNull();
      await expect(authService.authenticatePassword(email, "password")).rejects.toThrow(
        "Invalid credentials.",
      );
      const user = await authService.authenticatePassword(email, "new-member-pass");
      expect(user.id).toBe(created.id);
      expect(user.session_valid_after).toBeInstanceOf(Date);
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
        expect(enabled.user.mfa_enabled).toBe(true);
        expect(enabled.recoveryCodes).toHaveLength(8);

        await expect(
          authService.authenticatePassword("admin@workhub.test", "password"),
        ).rejects.toThrow("Two-factor authentication required.");
        await expect(authService.verifyMfaChallenge(1, "000000")).rejects.toThrow(
          "Invalid MFA code.",
        );

        const withCode = await authService.authenticatePassword("admin@workhub.test", "password", {
          mfaCode: generateTotp(setup.secret, Math.floor(Date.now() / 30_000)),
        });
        expect(withCode.id).toBe(1);

        const [recoveryCode] = enabled.recoveryCodes;
        const withRecovery = await authService.authenticatePassword(
          "admin@workhub.test",
          "password",
          { mfaCode: recoveryCode },
        );
        expect(withRecovery.id).toBe(1);
        await expect(
          authService.authenticatePassword("admin@workhub.test", "password", {
            mfaCode: recoveryCode,
          }),
        ).rejects.toThrow("Invalid MFA code.");

        await expect(authService.regenerateRecoveryCodes(1, "wrong-password")).rejects.toThrow(
          "Invalid credentials.",
        );
        const rotated = await authService.regenerateRecoveryCodes(1, "password");
        expect(rotated).toHaveLength(8);
        expect(rotated).not.toEqual(enabled.recoveryCodes);

        process.env.FEATURE_MFA = "false";
        await expect(
          authService.verifyMfaChallenge(
            1,
            generateTotp(setup.secret, Math.floor(Date.now() / 30_000)),
          ),
        ).rejects.toThrow("Two-factor authentication is not required.");
        process.env.FEATURE_MFA = "true";

        const challenged = await authService.verifyMfaChallenge(
          1,
          generateTotp(setup.secret, Math.floor(Date.now() / 30_000)),
        );
        expect(challenged.id).toBe(1);
        const issued = await authService.loginWithMfaChallenge(
          1,
          generateTotp(setup.secret, Math.floor(Date.now() / 30_000)),
        );
        expect(issued.plainTextToken).toBeTruthy();

        const disabled = await authService.disableMfa(1, "password");
        expect(disabled.mfa_enabled).toBe(false);
        await expect(authService.verifyMfaChallenge(1, "123456")).rejects.toThrow(
          "Two-factor authentication is not required.",
        );
        await expect(authService.regenerateRecoveryCodes(1, "password")).rejects.toThrow(
          "MFA is not enabled.",
        );

        const setupAgain = await authService.beginMfaSetup(1);
        const confirmAgain = await authService.confirmMfaSetup(
          1,
          generateTotp(setupAgain.secret, Math.floor(Date.now() / 30_000)),
        );
        expect(confirmAgain.user.mfa_enabled).toBe(true);

        for (const stored of ["not-json", "{}", "[1,true]", "[]"]) {
          await users.updateByIdOrThrow(1, { mfa_recovery_codes: stored });
          await expect(
            authService.authenticatePassword("admin@workhub.test", "password", {
              mfaCode: "abcd-efgh",
            }),
          ).rejects.toThrow("Invalid MFA code.");
        }

        const [lastCode] = generateRecoveryCodes(1);
        await users.updateByIdOrThrow(1, {
          mfa_recovery_codes: JSON.stringify([hashRecoveryCode(String(lastCode))]),
        });
        await authService.authenticatePassword("admin@workhub.test", "password", {
          mfaCode: lastCode,
        });
        expect((await users.findById(1))?.mfa_recovery_codes).toBeNull();
      } finally {
        await users.updateByIdOrThrow(1, {
          mfa_enabled: false,
          mfa_secret: null,
          mfa_recovery_codes: null,
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

  test("authenticateOAuth returns a user without creating a token", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const tokens = new TokenService(new UserRepository(), new ApiTokenRepository());
      const createToken = tokens.createToken.bind(tokens);
      let tokenCalls = 0;
      tokens.createToken = async (...args) => {
        tokenCalls += 1;
        return await createToken(...args);
      };

      const authService = new AuthService(
        new UserRepository(),
        tokens,
        new OAuthIdentityRepository(),
      );

      authService.registerOAuthProvider(
        new MockOAuthProvider({
          providerUserId: "oauth-session-user",
          email: "oauth-session@workhub.test",
          name: "OAuth Session User",
        }),
      );

      const user = await authService.authenticateOAuth("mock", "valid-code");
      expect(user.email).toBe("oauth-session@workhub.test");
      expect(tokenCalls).toBe(0);
    });
  });

  test("exposes registered oauth providers and authorization urls", async () => {
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
    expect(authService.listOAuthProviders()).toEqual([{ name: "mock", label: "Mock provider" }]);
    expect(authService.buildOAuthAuthorizationUrl("mock", "state-123")).toContain("state-123");
    expect(() => authService.buildOAuthAuthorizationUrl("missing", "state-123")).toThrow(
      "Unsupported OAuth provider.",
    );
    await expect(authService.authenticateOAuth("missing", "valid-code")).rejects.toThrow(
      "Unsupported OAuth provider.",
    );
  });
});
