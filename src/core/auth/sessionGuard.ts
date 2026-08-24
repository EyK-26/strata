import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
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

    const tokenService = resolveAuthUserDirectory(this.container);

    if (!tokenService) {
      return null;
    }

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
