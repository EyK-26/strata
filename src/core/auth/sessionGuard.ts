import type { ServiceContainer } from "../../bootstrap/contracts";
import { resolveAbilitiesForRole } from "../../domain/abilities";
import { tokenServiceToken } from "../../modules/user/provider";
import type TokenService from "../../modules/user/tokenService";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { readSessionUserId } from "./sessionCookie";

class SessionGuard implements AuthGuard {
  constructor(private readonly container: ServiceContainer) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const userId = readSessionUserId(request);

    if (!userId) {
      return null;
    }

    if (!this.container.has(tokenServiceToken)) {
      return null;
    }

    const tokenService = this.container.resolve<TokenService>(tokenServiceToken);

    try {
      const user = await tokenService.findByIdOrThrow(userId);

      return {
        id: user.id,
        role: user.role,
        abilities: resolveAbilitiesForRole(user.role),
      };
    } catch {
      return null;
    }
  }
}

export { SessionGuard };
