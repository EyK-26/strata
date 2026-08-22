import type { AuthUserDirectory } from "../contracts/authUserDirectory";
import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { CORE_TOKEN_SERVICE_TOKEN } from "../contracts/serviceTokens";
import { resolveAbilitiesForRole } from "./abilityCatalog";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { readSessionUserId } from "./sessionCookie";

class SessionGuard implements AuthGuard {
  constructor(private readonly container: ServiceContainerLike) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const userId = readSessionUserId(request);

    if (!userId) {
      return null;
    }

    if (!this.container.has(CORE_TOKEN_SERVICE_TOKEN)) {
      return null;
    }

    const tokenService = this.container.resolve<AuthUserDirectory>(CORE_TOKEN_SERVICE_TOKEN);

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
