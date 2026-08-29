import { describe, expect, test } from "bun:test";
import { hashPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { ValidationError } from "@getstrata/core/errors/http";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import PasswordResetService from "../../src/modules/user/passwordResetService";
import UserRepository from "../../src/modules/user/repository";
import { defaultTestTenant } from "./testHelpers";

describe("PasswordResetService", () => {
  test("requestReset is a no-op for unknown emails", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const service = new PasswordResetService(new UserRepository());
      await service.requestReset("missing@workhub.test");
      const rows = (await db`SELECT email FROM password_reset_token`) as Array<{ email: string }>;
      expect(rows.some((row) => row.email === "missing@workhub.test")).toBe(false);
    });
  });

  test("requestReset stores a hashed token and resetPassword updates the user", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const service = new PasswordResetService(users);
      await service.requestReset("admin@workhub.test");

      const stored = (await db`
        SELECT token FROM password_reset_token WHERE email = 'admin@workhub.test' LIMIT 1
      `) as Array<{ token: string }>;

      expect(stored[0]?.token).toBeTruthy();

      const token = "integration-reset-token";
      await db`
        UPDATE password_reset_token
        SET token = ${hashApiToken(token)}
        WHERE email = 'admin@workhub.test'
      `;

      await service.resetPassword("admin@workhub.test", token, "new-password-123");

      const remaining = (await db`
        SELECT token FROM password_reset_token WHERE email = 'admin@workhub.test'
      `) as Array<{ token: string }>;
      expect(remaining).toHaveLength(0);

      await expect(
        service.resetPassword("admin@workhub.test", token, "another-pass"),
      ).rejects.toBeInstanceOf(ValidationError);

      await users.updateByIdOrThrow(1, { password_hash: await hashPassword("password") });
    });
  });

  test("resetPassword rejects expired tokens", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const service = new PasswordResetService(new UserRepository());
      const token = "expired-reset-token";
      await db`DELETE FROM password_reset_token WHERE email = 'member@workhub.test'`;
      await db`
        INSERT INTO password_reset_token (email, token, created_at)
        VALUES (
          'member@workhub.test',
          ${hashApiToken(token)},
          ${new Date(Date.now() - 2 * 60 * 60 * 1000)}
        )
      `;

      await expect(
        service.resetPassword("member@workhub.test", token, "new-password-123"),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  test("resetPassword rejects a token whose user no longer exists", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const service = new PasswordResetService(new UserRepository());
      const token = "orphan-reset-token";
      await db`DELETE FROM password_reset_token WHERE email = 'gone@workhub.test'`;
      await db`
        INSERT INTO password_reset_token (email, token, created_at)
        VALUES ('gone@workhub.test', ${hashApiToken(token)}, NOW())
      `;

      await expect(
        service.resetPassword("gone@workhub.test", token, "new-password-123"),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  test("sendEmailVerification writes a markdown mail", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const users = new UserRepository();
      const service = new PasswordResetService(users);
      const user = await users.findByEmail("admin@workhub.test");

      expect(user).not.toBeNull();
      await service.sendEmailVerification(user!);
    });
  });
});
