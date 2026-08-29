import type { OAuthProvider } from "@getstrata/core/auth/oauth/types";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { normalizeEmail } from "@getstrata/core/crypto/fieldEncryption";
import { protectMfaSecret, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  recoveryCodeMatches,
} from "@getstrata/core/security/recoveryCodes";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { isFeatureEnabled } from "../../config/features";
import { resolveAbilitiesForRole } from "../../domain/abilities";
import { MfaRequiredError } from "./mfaRequiredError";
import type OAuthIdentityRepository from "./oauthIdentityRepository";
import type UserRepository from "./repository";
import type TokenService from "./tokenService";
import type { CreatedApiToken, UserRecord } from "./types";

interface LoginOptions {
  mfaCode?: string;
}

interface MfaConfirmation {
  user: UserRecord;
  recoveryCodes: string[];
}

class AuthService {
  private readonly oauthProviders = new Map<string, OAuthProvider>();

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly oauthIdentities: OAuthIdentityRepository,
  ) {}

  registerOAuthProvider(provider: OAuthProvider): void {
    this.oauthProviders.set(provider.name, provider);
  }

  getOAuthProvider(name: string): OAuthProvider | undefined {
    return this.oauthProviders.get(name);
  }

  listOAuthProviders(): Array<{ name: string; label: string }> {
    const labels: Record<string, string> = {
      github: "GitHub",
      oidc: "OpenID Connect",
      saml: "SAML",
      mock: "Mock provider",
    };

    return [...this.oauthProviders.keys()].sort().map((name) => ({
      name,
      label: labels[name] ?? name,
    }));
  }

  async authenticatePassword(
    email: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<UserRecord> {
    const user = await this.users.findByEmail(email);

    if (!user?.password_hash) {
      logSecurityEvent("auth_login_failed", { reason: "unknown_user", email });
      throw new UnauthorizedError("Invalid credentials.");
    }

    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      logSecurityEvent("auth_login_failed", { reason: "invalid_password", user_id: user.id });
      throw new UnauthorizedError("Invalid credentials.");
    }

    if (isFeatureEnabled("emailVerification") && !user.email_verified_at) {
      logSecurityEvent("auth_login_blocked", { reason: "email_unverified", user_id: user.id });
      throw new UnauthorizedError("Email address is not verified.");
    }

    if (isFeatureEnabled("mfa") && user.mfa_enabled) {
      await this.assertMfaSatisfied(user, options.mfaCode);
    }

    logSecurityEvent("auth_login_success", { user_id: user.id, method: "password" });

    return user;
  }

  async verifyMfaChallenge(userId: number, code: string): Promise<UserRecord> {
    const user = await this.users.findByIdOrThrow(userId);

    if (!isFeatureEnabled("mfa") || !user.mfa_enabled) {
      throw new UnauthorizedError("Two-factor authentication is not required.");
    }

    await this.assertMfaSatisfied(user, code);
    logSecurityEvent("auth_login_success", { user_id: user.id, method: "mfa_challenge" });

    return await this.users.findByIdOrThrow(userId);
  }

  async loginWithPassword(
    email: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<CreatedApiToken> {
    const user = await this.authenticatePassword(email, password, options);

    return await this.issuePasswordLoginToken(user);
  }

  async loginWithMfaChallenge(userId: number, code: string): Promise<CreatedApiToken> {
    const user = await this.verifyMfaChallenge(userId, code);

    return await this.issuePasswordLoginToken(user);
  }

  private async issuePasswordLoginToken(user: UserRecord): Promise<CreatedApiToken> {
    return await this.tokens.createToken(user.id, {
      name: "password-login",
      abilities: resolveAbilitiesForRole(user.role),
      expiresInDays: resolveDefaultTokenExpiryDays() ?? undefined,
    });
  }

  async markEmailVerified(userId: number): Promise<UserRecord> {
    return await this.users.updateByIdOrThrow(userId, {
      email_verified_at: new Date(),
      updated_at: new Date(),
    });
  }

  async beginMfaSetup(userId: number): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.users.findByIdOrThrow(userId);

    if (user.mfa_enabled) {
      throw new ValidationError("MFA is already enabled.", {
        mfa: ["MFA is already enabled."],
      });
    }

    const secret = generateTotpSecret();
    await this.users.updateByIdOrThrow(userId, {
      mfa_secret: protectMfaSecret(secret),
      mfa_enabled: false,
      updated_at: new Date(),
    });

    return {
      secret,
      otpauthUrl: buildOtpauthUrl({ secret, account: user.email }),
    };
  }

  async confirmMfaSetup(userId: number, code: string): Promise<MfaConfirmation> {
    const user = await this.users.findByIdOrThrow(userId);
    const secret = revealMfaSecret(user.mfa_secret);

    if (!secret || !verifyTotp(secret, code)) {
      logSecurityEvent("auth_mfa_failed", { reason: "invalid_setup_code", user_id: user.id });
      throw new ValidationError("Invalid MFA code.", {
        mfa_code: ["Invalid MFA code."],
      });
    }

    const recoveryCodes = generateRecoveryCodes();
    const updated = await this.users.updateByIdOrThrow(userId, {
      mfa_enabled: true,
      mfa_recovery_codes: JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))),
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_enabled", { user_id: user.id });

    return { user: updated, recoveryCodes };
  }

  async regenerateRecoveryCodes(userId: number, password: string): Promise<string[]> {
    const user = await this.users.findByIdOrThrow(userId);

    if (!user.mfa_enabled) {
      throw new ValidationError("MFA is not enabled.", {
        mfa: ["MFA is not enabled."],
      });
    }

    if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      logSecurityEvent("auth_mfa_failed", { reason: "invalid_password", user_id: user.id });
      throw new UnauthorizedError("Invalid credentials.");
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.users.updateByIdOrThrow(userId, {
      mfa_recovery_codes: JSON.stringify(recoveryCodes.map((item) => hashRecoveryCode(item))),
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_recovery_codes_rotated", { user_id: user.id });

    return recoveryCodes;
  }

  async disableMfa(userId: number, password: string): Promise<UserRecord> {
    const user = await this.users.findByIdOrThrow(userId);

    if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      logSecurityEvent("auth_mfa_failed", { reason: "invalid_password", user_id: user.id });
      throw new UnauthorizedError("Invalid credentials.");
    }

    const updated = await this.users.updateByIdOrThrow(userId, {
      mfa_enabled: false,
      mfa_secret: null,
      mfa_recovery_codes: null,
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_disabled", { user_id: user.id });

    return updated;
  }

  async confirmCurrentPassword(userId: number, password: string): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);

    if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      logSecurityEvent("auth_password_confirm_failed", {
        reason: "invalid_password",
        user_id: user.id,
      });
      throw new UnauthorizedError("Invalid credentials.");
    }

    logSecurityEvent("auth_password_confirmed", { user_id: user.id });
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    nextPassword: string,
  ): Promise<UserRecord> {
    const user = await this.users.findByIdOrThrow(userId);

    if (!user.password_hash || !(await verifyPassword(currentPassword, user.password_hash))) {
      logSecurityEvent("auth_password_change_failed", {
        reason: "invalid_password",
        user_id: user.id,
      });
      throw new UnauthorizedError("Invalid credentials.");
    }

    if (currentPassword === nextPassword) {
      throw new ValidationError("Choose a different password.", {
        password: ["Choose a different password."],
      });
    }

    const updated = await this.users.updateByIdOrThrow(userId, {
      password_hash: await hashPassword(nextPassword),
      updated_at: new Date(),
    });
    logSecurityEvent("auth_password_changed", { user_id: user.id });

    return updated;
  }

  async updateProfile(
    userId: number,
    name: string,
    email: string,
  ): Promise<{ user: UserRecord; emailChanged: boolean }> {
    const user = await this.users.findByIdOrThrow(userId);
    const nextName = name.trim();
    const nextEmail = email.trim();
    const emailChanged = normalizeEmail(nextEmail) !== normalizeEmail(user.email);
    const taken = await this.users.findByEmail(nextEmail);

    if (taken && taken.id !== userId) {
      throw new ValidationError("An account with this email already exists.", {
        email: ["An account with this email already exists."],
      });
    }

    const updated = await this.users.updateByIdOrThrow(userId, {
      name: nextName,
      ...(emailChanged
        ? {
            email: nextEmail,
            email_verified_at: isFeatureEnabled("emailVerification")
              ? null
              : (user.email_verified_at ?? new Date()),
          }
        : {}),
      updated_at: new Date(),
    });
    logSecurityEvent("auth_profile_updated", {
      user_id: user.id,
      email_changed: emailChanged,
    });

    return { user: updated, emailChanged };
  }

  async registerWithPassword(name: string, email: string, password: string): Promise<UserRecord> {
    if (await this.users.findByEmail(email)) {
      throw new ValidationError("An account with this email already exists.", {
        email: ["An account with this email already exists."],
      });
    }

    const user = await this.users.create({
      name: name.trim(),
      email: email.trim(),
      role: "member",
      tenant_id: currentTenantId(),
      password_hash: await hashPassword(password),
      email_verified_at: isFeatureEnabled("emailVerification") ? null : new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    logSecurityEvent("auth_register_success", { user_id: user.id });

    return user;
  }

  async authenticateOAuth(
    providerName: string,
    code: string,
    options: { redirectUri?: string } = {},
  ): Promise<UserRecord> {
    const provider = this.oauthProviders.get(providerName);

    if (!provider) {
      throw new UnauthorizedError("Unsupported OAuth provider.");
    }

    const profile = await provider.exchangeCode(code, options.redirectUri);
    const user = await this.findOrCreateOAuthUser(providerName, profile);

    logSecurityEvent("auth_login_success", { user_id: user.id, method: `oauth:${providerName}` });

    return user;
  }

  async loginWithOAuth(
    providerName: string,
    code: string,
    options: { redirectUri?: string } = {},
  ): Promise<CreatedApiToken> {
    const user = await this.authenticateOAuth(providerName, code, options);

    return await this.tokens.createToken(user.id, {
      name: `${providerName}-oauth`,
      abilities: resolveAbilitiesForRole(user.role),
      expiresInDays: resolveDefaultTokenExpiryDays() ?? undefined,
    });
  }

  buildOAuthAuthorizationUrl(providerName: string, state: string, redirectUri?: string): string {
    const provider = this.oauthProviders.get(providerName);

    if (!provider) {
      throw new UnauthorizedError("Unsupported OAuth provider.");
    }

    return provider.getAuthorizationUrl(state, redirectUri);
  }

  private async assertMfaSatisfied(user: UserRecord, mfaCode?: string): Promise<void> {
    if (!mfaCode) {
      throw new MfaRequiredError(user.id);
    }

    const mfaSecret = revealMfaSecret(user.mfa_secret);
    const totpValid = Boolean(mfaSecret && verifyTotp(mfaSecret, mfaCode));
    const recovered = !totpValid ? await this.consumeRecoveryCode(user, mfaCode) : false;

    if (!totpValid && !recovered) {
      logSecurityEvent("auth_login_failed", { reason: "invalid_mfa", user_id: user.id });
      throw new UnauthorizedError("Invalid MFA code.");
    }
  }

  private parseRecoveryHashes(raw: string | null | undefined): string[] {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
    } catch {
      return [];
    }
  }

  private async consumeRecoveryCode(user: UserRecord, code: string): Promise<boolean> {
    const hashes = this.parseRecoveryHashes(user.mfa_recovery_codes);
    const index = hashes.findIndex((hash) => recoveryCodeMatches(code, hash));

    if (index === -1) {
      return false;
    }

    const remaining = hashes.filter((_, hashIndex) => hashIndex !== index);
    await this.users.updateByIdOrThrow(user.id, {
      mfa_recovery_codes: remaining.length > 0 ? JSON.stringify(remaining) : null,
      updated_at: new Date(),
    });

    logSecurityEvent("auth_mfa_recovery_code_used", { user_id: user.id });

    return true;
  }

  private async findOrCreateOAuthUser(
    providerName: string,
    profile: { providerUserId: string; email: string; name: string },
  ): Promise<UserRecord> {
    const existingIdentity = await this.oauthIdentities.findByProviderUser(
      providerName,
      profile.providerUserId,
    );

    if (existingIdentity) {
      return await this.users.findByIdOrThrow(existingIdentity.user_id);
    }

    const existingUser = await this.users.findByEmail(profile.email);
    const user =
      existingUser ??
      (await this.users.create({
        name: profile.name,
        email: profile.email,
        role: "member",
        tenant_id: currentTenantId(),
        email_verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      }));

    await this.oauthIdentities.create({
      user_id: user.id,
      provider: providerName,
      provider_user_id: profile.providerUserId,
      email: profile.email,
      created_at: new Date(),
    });

    return user;
  }
}

export default AuthService;
export type { LoginOptions, MfaConfirmation };
export { MfaRequiredError };
