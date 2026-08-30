import { randomBytes } from "node:crypto";
import { hashPassword } from "@getstrata/core/auth/password";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { ValidationError } from "@getstrata/core/errors/http";
import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { mailer } from "@getstrata/core/mail/mailer";
import { sendMarkdownMail } from "@getstrata/core/mail/markdownMailable";
import { appDisplayName } from "@getstrata/core/runtime/appKeyPrefix";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";
import { appConfig } from "../../config/app";
import type UserRepository from "./repository";
import type { UserRecord } from "./types";

const RESET_TTL_SECONDS = 60 * 60;
const VERIFY_TTL_SECONDS = 60 * 60 * 24;

interface PasswordResetTokenRow {
  email: string;
  token: string;
  created_at: Date;
}

class PasswordResetService {
  constructor(private readonly users: UserRepository) {}

  async requestReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);

    if (!user) {
      logSecurityEvent("password_reset_ignored", { reason: "unknown_user" });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashApiToken(token);

    await db`DELETE FROM password_reset_token WHERE email = ${user.email}`;
    await db`
      INSERT INTO password_reset_token (email, token, created_at)
      VALUES (${user.email}, ${tokenHash}, NOW())
    `;

    const resetUrl = absoluteTemporarySignedUrl(
      "/reset-password",
      RESET_TTL_SECONDS,
      { email: user.email, token },
      appConfig.url,
    );

    const appName = appDisplayName();
    await sendMarkdownMail(mailer(), {
      to: user.email,
      subject: `Reset your ${appName} password`,
      markdown: `# Reset your password

Use this signed link to choose a new password. It expires in 60 minutes.

[Reset password](${resetUrl})

If you did not request this, you can ignore the email.`,
      layout: { title: "Reset your password", footer: appName },
    });

    logSecurityEvent("password_reset_sent", { user_id: user.id });
  }

  async resetPassword(email: string, token: string, password: string): Promise<void> {
    const rows = (await db`
      SELECT email, token, created_at
      FROM password_reset_token
      WHERE email = ${email}
      LIMIT 1
    `) as PasswordResetTokenRow[];
    const stored = rows[0];

    if (!stored || !timingSafeCompareString(stored.token, hashApiToken(token))) {
      throw new ValidationError("This reset link is invalid.", {
        token: ["This reset link is invalid."],
      });
    }

    const ageMs = Date.now() - new Date(stored.created_at).getTime();

    if (ageMs > RESET_TTL_SECONDS * 1000) {
      await db`DELETE FROM password_reset_token WHERE email = ${email}`;
      throw new ValidationError("This reset link has expired.", {
        token: ["This reset link has expired."],
      });
    }

    const user = await this.users.findByEmail(email);

    if (!user) {
      throw new ValidationError("This reset link is invalid.", {
        email: ["This reset link is invalid."],
      });
    }

    await this.users.updateByIdOrThrow(user.id, {
      password_hash: await hashPassword(password),
      updated_at: new Date(),
    });
    await db`DELETE FROM password_reset_token WHERE email = ${email}`;
    logSecurityEvent("password_reset_completed", { user_id: user.id });
  }

  async requestEmailVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);

    if (!user) {
      logSecurityEvent("email_verification_ignored", { reason: "unknown_user" });
      return;
    }

    if (user.email_verified_at) {
      logSecurityEvent("email_verification_ignored", { reason: "already_verified" });
      return;
    }

    await this.sendEmailVerification(user);
  }

  async sendEmailVerification(user: UserRecord): Promise<void> {
    const verifyUrl = absoluteTemporarySignedUrl(
      "/verify-email",
      VERIFY_TTL_SECONDS,
      { id: user.id },
      appConfig.url,
    );

    const appName = appDisplayName();
    await sendMarkdownMail(mailer(), {
      to: user.email,
      subject: `Verify your ${appName} email`,
      markdown: `# Confirm your email

[Verify email address](${verifyUrl})

This signed link expires in 24 hours.`,
      layout: { title: "Verify your email", footer: appName },
    });

    logSecurityEvent("email_verification_sent", { user_id: user.id });
  }
}

export default PasswordResetService;
export { RESET_TTL_SECONDS, VERIFY_TTL_SECONDS };
