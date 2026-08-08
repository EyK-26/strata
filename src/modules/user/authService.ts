import { isFeatureEnabled } from "../../config/features";
import type { OAuthProvider } from "../../core/auth/oauth/types";
import { verifyPassword } from "../../core/auth/password";
import { UnauthorizedError } from "../../core/errors/http";
import { logSecurityEvent } from "../../core/security/securityEvents";
import { resolveDefaultTokenExpiryDays } from "../../core/security/tokenExpiry";
import { verifyTotp } from "../../core/security/totp";
import { currentTenantId } from "../../core/tenant/tenantContext";
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

  async loginWithPassword(
    email: string,
    password: string,
    options: LoginOptions = {},
  ): Promise<CreatedApiToken> {
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
      if (!user.mfa_secret || !options.mfaCode || !verifyTotp(user.mfa_secret, options.mfaCode)) {
        logSecurityEvent("auth_login_failed", { reason: "invalid_mfa", user_id: user.id });
        throw new UnauthorizedError("Invalid MFA code.");
      }
    }

    logSecurityEvent("auth_login_success", { user_id: user.id, method: "password" });

    return await this.tokens.createToken(user.id, {
      name: "password-login",
      abilities: ["*"],
      expiresInDays: resolveDefaultTokenExpiryDays() ?? undefined,
    });
  }

  async loginWithOAuth(providerName: string, code: string): Promise<CreatedApiToken> {
    const provider = this.oauthProviders.get(providerName);

    if (!provider) {
      throw new UnauthorizedError("Unsupported OAuth provider.");
    }

    const profile = await provider.exchangeCode(code);
    const user = await this.findOrCreateOAuthUser(providerName, profile);

    logSecurityEvent("auth_login_success", { user_id: user.id, method: `oauth:${providerName}` });

    return await this.tokens.createToken(user.id, {
      name: `${providerName}-oauth`,
      abilities: ["*"],
      expiresInDays: resolveDefaultTokenExpiryDays() ?? undefined,
    });
  }

  buildOAuthAuthorizationUrl(providerName: string, state: string): string {
    const provider = this.oauthProviders.get(providerName);

    if (!provider) {
      throw new UnauthorizedError("Unsupported OAuth provider.");
    }

    return provider.getAuthorizationUrl(state);
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
