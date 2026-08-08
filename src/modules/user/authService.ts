import type { OAuthProvider } from "../../core/auth/oauth/types";
import { verifyPassword } from "../../core/auth/password";
import { UnauthorizedError } from "../../core/errors/http";
import type OAuthIdentityRepository from "./oauthIdentityRepository";
import type UserRepository from "./repository";
import type TokenService from "./tokenService";
import type { CreatedApiToken, UserRecord } from "./types";

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

  async loginWithPassword(email: string, password: string): Promise<CreatedApiToken> {
    const user = await this.users.findByEmail(email);

    if (!user?.password_hash) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    return await this.tokens.createToken(user.id, {
      name: "password-login",
      abilities: ["*"],
    });
  }

  async loginWithOAuth(providerName: string, code: string): Promise<CreatedApiToken> {
    const provider = this.oauthProviders.get(providerName);

    if (!provider) {
      throw new UnauthorizedError("Unsupported OAuth provider.");
    }

    const profile = await provider.exchangeCode(code);
    const user = await this.findOrCreateOAuthUser(providerName, profile);

    return await this.tokens.createToken(user.id, {
      name: `${providerName}-oauth`,
      abilities: ["*"],
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
