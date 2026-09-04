import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { protectMfaSecret, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  recoveryCodeMatches,
} from "@getstrata/core/security/recoveryCodes";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";
import { isStaff } from "../../lib/roles.ts";
import { type UserRecord, users } from "../users/repository.ts";
import { tokenService } from "./tokenService.ts";

export class AccountService {
  async updateProfile(
    userId: number,
    firstName: string,
    lastName: string,
    email: string,
  ): Promise<UserRecord> {
    const user = await users.findByIdOrThrow(userId);
    const nextEmail = email.trim().toLowerCase();
    const taken = await users.findByEmail(nextEmail);
    if (taken && taken.id !== userId) {
      throw new ValidationError("The given data was invalid.", {
        email: ["An account with this email already exists."],
      });
    }
    const emailChanged = nextEmail !== user.email.toLowerCase();
    const updated = await users.updateByIdOrThrow(userId, {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      ...(emailChanged ? { email: nextEmail, email_verified_at: null } : {}),
      updated_at: new Date(),
    });
    logSecurityEvent("auth_profile_updated", { user_id: userId, email_changed: emailChanged });
    return updated;
  }

  async changePassword(userId: number, currentPassword: string, nextPassword: string) {
    const user = await users.findByIdOrThrow(userId);
    if (!(await verifyPassword(currentPassword, user.password))) {
      throw new UnauthorizedError("Invalid credentials.");
    }
    if (currentPassword === nextPassword) {
      throw new ValidationError("The given data was invalid.", {
        password: ["Choose a different password."],
      });
    }
    const updated = await users.updateByIdOrThrow(userId, {
      password: await hashPassword(nextPassword),
      session_valid_after: new Date(),
      updated_at: new Date(),
    });
    await tokenService.revokeOtherTokens(userId);
    logSecurityEvent("auth_password_changed", { user_id: userId });
    return updated;
  }

  async confirmCurrentPassword(userId: number, password: string): Promise<void> {
    const user = await users.findByIdOrThrow(userId);
    if (!(await verifyPassword(password, user.password))) {
      throw new UnauthorizedError("Invalid credentials.");
    }
  }

  async beginMfaSetup(user: UserRecord): Promise<{ secret: string; otpauthUrl: string }> {
    if (user.mfa_enabled) {
      throw new ValidationError("The given data was invalid.", {
        mfa: ["MFA is already enabled."],
      });
    }
    const secret = generateTotpSecret();
    await users.updateByIdOrThrow(user.id, {
      mfa_secret: protectMfaSecret(secret),
      mfa_enabled: false,
      updated_at: new Date(),
    });
    return {
      secret,
      otpauthUrl: buildOtpauthUrl({ secret, account: user.email }),
    };
  }

  async confirmMfaSetup(userId: number, code: string) {
    const user = await users.findByIdOrThrow(userId);
    const secret = revealMfaSecret(user.mfa_secret);
    if (!secret || !verifyTotp(secret, code)) {
      throw new ValidationError("The given data was invalid.", {
        mfa_code: ["Invalid MFA code."],
      });
    }
    const recoveryCodes = generateRecoveryCodes();
    const updated = await users.updateByIdOrThrow(userId, {
      mfa_enabled: true,
      mfa_recovery_codes: JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))),
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_enabled", { user_id: userId });
    return { user: updated, recoveryCodes };
  }

  async regenerateRecoveryCodes(userId: number, password: string) {
    const user = await users.findByIdOrThrow(userId);
    if (!user.mfa_enabled) {
      throw new ValidationError("The given data was invalid.", {
        mfa: ["MFA is not enabled."],
      });
    }
    await this.confirmCurrentPassword(userId, password);
    const recoveryCodes = generateRecoveryCodes();
    await users.updateByIdOrThrow(userId, {
      mfa_recovery_codes: JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))),
      updated_at: new Date(),
    });
    return recoveryCodes;
  }

  async disableMfa(userId: number, password: string) {
    await this.confirmCurrentPassword(userId, password);
    const updated = await users.updateByIdOrThrow(userId, {
      mfa_enabled: false,
      mfa_secret: null,
      mfa_recovery_codes: null,
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_disabled", { user_id: userId });
    return updated;
  }

  async verifyMfaChallenge(userId: number, code: string) {
    const user = await users.findByIdOrThrow(userId);
    if (!user.mfa_enabled || !isStaff(user.role_id)) {
      throw new UnauthorizedError("Two-factor authentication is not required.");
    }
    await this.assertMfaSatisfied(user, code);
    return users.findByIdOrThrow(userId);
  }

  staffRequiresMfa(user: UserRecord) {
    return isStaff(user.role_id) && Boolean(user.mfa_enabled);
  }

  private async assertMfaSatisfied(user: UserRecord, mfaCode?: string) {
    if (!mfaCode) {
      throw new UnauthorizedError("Two-factor authentication required.");
    }
    const secret = revealMfaSecret(user.mfa_secret);
    const totpValid = Boolean(secret && verifyTotp(secret, mfaCode));
    const recovered = !totpValid ? await this.consumeRecoveryCode(user, mfaCode) : false;
    if (!totpValid && !recovered) {
      throw new UnauthorizedError("Invalid MFA code.");
    }
  }

  private parseRecoveryHashes(raw: string | null | undefined): string[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  private async consumeRecoveryCode(user: UserRecord, code: string) {
    const hashes = this.parseRecoveryHashes(user.mfa_recovery_codes);
    const index = hashes.findIndex((hash) => recoveryCodeMatches(code, hash));
    if (index === -1) {
      return false;
    }
    const remaining = hashes.filter((_, hashIndex) => hashIndex !== index);
    await users.updateByIdOrThrow(user.id, {
      mfa_recovery_codes: remaining.length > 0 ? JSON.stringify(remaining) : null,
      updated_at: new Date(),
    });
    return true;
  }
}

export const accountService = new AccountService();
