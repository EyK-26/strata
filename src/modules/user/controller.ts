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
import TokenService from "./tokenService";
import { tokenServiceToken } from "./provider";
import { parseCreateApiTokenBody, parseTokenIdParams, type TokenIdParams } from "./requests";
import { toUserResource } from "./resources";

class AuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get auth(): AuthManager {
    return resolveService(this.dependencies, CORE_AUTH_TOKEN);
  }

  private get tokens(): TokenService {
    return resolveService(this.dependencies, tokenServiceToken);
  }

  private async requireUserId(request: Request): Promise<number> {
    const user = await this.auth.requireUser(request);
    const userId = typeof user.id === "number" ? user.id : Number(user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Unauthorized");
    }

    return userId;
  }

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
