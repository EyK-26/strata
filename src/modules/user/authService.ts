import type { OAuthProvider } from "@getstrata/core/auth/oauth/types";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { protectMfaSecret, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { resolveDefaultTokenExpiryDays } from "@getstrata/core/security/tokenExpiry";
import { buildOtpauthUrl, generateTotpSecret, verifyTotp } from "@getstrata/core/security/totp";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { isFeatureEnabled } from "../../config/features";
import { resolveAbilitiesForRole } from "../../domain/abilities";
import type OAuthIdentityRepository from "./oauthIdentityRepository";
import type UserRepository from "./repository";
import type TokenService from "./tokenService";
import type { CreatedApiToken, UserRecord } from "./types";

interface LoginOptions {
  mfaCode?: string;
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
      const mfaSecret = revealMfaSecret(user.mfa_secret);

      if (!mfaSecret || !options.mfaCode || !verifyTotp(mfaSecret, options.mfaCode)) {
        logSecurityEvent("auth_login_failed", { reason: "invalid_mfa", user_id: user.id });
        throw new UnauthorizedError("Invalid MFA code.");
      }
    }

    logSecurityEvent("auth_login_success", { user_id: user.id, method: "password" });

    return user;
  }

  async loginWithPassword(
    email: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<CreatedApiToken> {
    const user = await this.authenticatePassword(email, password, options);

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

  async confirmMfaSetup(userId: number, code: string): Promise<UserRecord> {
    const user = await this.users.findByIdOrThrow(userId);
    const secret = revealMfaSecret(user.mfa_secret);

    if (!secret || !verifyTotp(secret, code)) {
      logSecurityEvent("auth_mfa_failed", { reason: "invalid_setup_code", user_id: user.id });
      throw new ValidationError("Invalid MFA code.", {
        mfa_code: ["Invalid MFA code."],
      });
    }

    const updated = await this.users.updateByIdOrThrow(userId, {
      mfa_enabled: true,
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_enabled", { user_id: user.id });

    return updated;
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
      updated_at: new Date(),
    });
    logSecurityEvent("auth_mfa_disabled", { user_id: user.id });

    return updated;
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
export type { LoginOptions };
