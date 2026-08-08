import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { CORE_AUTH_TOKEN } from "../../bootstrap/config";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "../../core/http";
import type { AuthManager } from "../../core/auth/guard";
import AuthService from "./authService";
import TokenService from "./tokenService";
import { authServiceToken, tokenServiceToken } from "./provider";
import {
  parseCreateApiTokenBody,
  parseLoginBody,
  parseTokenIdParams,
  type OAuthProviderParams,
  type TokenIdParams,
} from "./requests";
import { toUserResource } from "./resources";

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
    const created = await this.authService.loginWithPassword(body.email, body.password);
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

    const state = crypto.randomUUID();
    const url = this.authService.buildOAuthAuthorizationUrl(provider, state);

    return Response.redirect(url, 302);
  });

  readonly oauthCallback = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: OAuthProviderParams }).params;
    const provider = params?.provider;
    const code = new URL(request.url).searchParams.get("code");

    if (!provider || !code) {
      throw new Error("OAuth provider and code are required.");
    }

    const created = await this.authService.loginWithOAuth(provider, code);
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

  readonly me = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const record = await this.tokens.findByIdOrThrow(userId);
    return jsonResponse(toUserResource(record));
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
