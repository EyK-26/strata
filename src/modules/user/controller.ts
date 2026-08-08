import { CORE_AUTH_TOKEN } from "../../bootstrap/config";
import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import type { AuthManager } from "../../core/auth/guard";
import { UnauthorizedError } from "../../core/errors/http";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "../../core/http";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "../../core/security/oauthState";
import ApiTokenRepository from "./apiTokenRepository";
import type AuthService from "./authService";
import OAuthIdentityRepository from "./oauthIdentityRepository";
import { authServiceToken, tokenServiceToken } from "./provider";
import {
  type OAuthProviderParams,
  parseCreateApiTokenBody,
  parseLoginBody,
  parseTokenIdParams,
  type TokenIdParams,
} from "./requests";
import { toUserResource } from "./resources";
import type TokenService from "./tokenService";

class AuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get auth(): AuthManager {
    return resolveService(this.dependencies, CORE_AUTH_TOKEN);
  }

  private get tokens(): TokenService {
    return resolveService(this.dependencies, tokenServiceToken);
  }

  private get authService(): AuthService {
    return resolveService(this.dependencies, authServiceToken);
  }

  private async requireUserId(request: Request): Promise<number> {
    const user = await this.auth.requireUser(request);
    const userId = typeof user.id === "number" ? user.id : Number(user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Unauthorized");
    }

    return userId;
  }

  readonly login = withErrorHandling(async (request: Request) => {
    const body = await parseLoginBody(request);
    const created = await this.authService.loginWithPassword(body.email, body.password, {
      mfaCode: body.mfa_code,
    });
    const authUser = await this.tokens.resolveUserFromToken(created.plainTextToken);

    if (!authUser) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const user = await this.tokens.findByIdOrThrow(Number(authUser.id));

    return createdResponse({
      token: created.plainTextToken,
      user: toUserResource(user),
    });
  });

  readonly oauthRedirect = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: OAuthProviderParams }).params;
    const provider = params?.provider;

    if (!provider) {
      throw new Error("OAuth provider is required.");
    }

    const { state, cookie } = createOAuthStateCookie();
    const url = this.authService.buildOAuthAuthorizationUrl(provider, state);

    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Set-Cookie": cookie,
      },
    });
  });

  readonly oauthCallback = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: OAuthProviderParams }).params;
    const provider = params?.provider;
    const callbackUrl = new URL(request.url);
    const code = callbackUrl.searchParams.get("code");
    const returnedState = callbackUrl.searchParams.get("state");

    if (!provider || !code) {
      throw new Error("OAuth provider and code are required.");
    }

    if (!verifyOAuthState(request, returnedState)) {
      throw new UnauthorizedError("Invalid OAuth state.");
    }

    const created = await this.authService.loginWithOAuth(provider, code);
    const authUser = await this.tokens.resolveUserFromToken(created.plainTextToken);

    if (!authUser) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const user = await this.tokens.findByIdOrThrow(Number(authUser.id));

    return createdResponse(
      {
        token: created.plainTextToken,
        user: toUserResource(user),
      },
      {
        headers: {
          "Set-Cookie": clearOAuthStateCookie(),
        },
      },
    );
  });

  readonly me = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const record = await this.tokens.findByIdOrThrow(userId);
    return jsonResponse(toUserResource(record));
  });

  readonly exportMe = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const user = await this.tokens.findByIdOrThrow(userId);
    const tokenRepo = new ApiTokenRepository();
    const oauthRepo = new OAuthIdentityRepository();

    const tokens = await tokenRepo.findAll({
      where: { user_id: userId },
    });
    const identities = await oauthRepo.findAll({
      where: { user_id: userId },
    });

    return jsonResponse({
      user: toUserResource(user),
      api_tokens: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        abilities: token.abilities,
        created_at: token.created_at.toISOString(),
      })),
      oauth_identities: identities.map((identity) => ({
        provider: identity.provider,
        email: identity.email,
        created_at: identity.created_at.toISOString(),
      })),
      exported_at: new Date().toISOString(),
    });
  });

  readonly deleteMe = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    await this.tokens.deleteUserAccount(userId);
    return noContentResponse();
  });

  readonly listTokens = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    return jsonResponse({ data: await this.tokens.listTokensForUser(userId) });
  });

  readonly storeToken = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parseCreateApiTokenBody(request);
    const created = await this.tokens.createToken(userId, {
      name: body.name,
      abilities: body.abilities,
      expiresInDays: body.expires_in_days,
    });

    return createdResponse({
      token: created.plainTextToken,
      ...created.token,
    });
  });

  readonly destroyToken = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const params = (request as Request & { params?: TokenIdParams }).params;

    if (!params?.id) {
      throw new Error("Token id is required.");
    }

    const { id } = parseTokenIdParams(params);
    await this.tokens.revokeToken(userId, id);
    return noContentResponse();
  });
}

export default AuthController;
