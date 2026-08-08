import type { AppDependencies } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { CORE_AUTH_TOKEN } from "../../bootstrap/config";
import { jsonResponse, withErrorHandling } from "../../core/http";
import type { AuthManager } from "../../core/auth/guard";
import TokenService from "./tokenService";
import { tokenServiceToken } from "./provider";
import { toUserResource } from "./resources";

class AuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get auth(): AuthManager {
    return resolveService(this.dependencies, CORE_AUTH_TOKEN);
  }

  private get tokens(): TokenService {
    return resolveService(this.dependencies, tokenServiceToken);
  }

  readonly me = withErrorHandling(async (request: Request) => {
    const user = await this.auth.requireUser(request);
    const userId = typeof user.id === "number" ? user.id : Number(user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }

    const record = await this.tokens.findByIdOrThrow(userId);
    return jsonResponse(toUserResource(record));
  });
}

export default AuthController;
