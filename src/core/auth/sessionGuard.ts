import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { resolveAbilitiesForRole } from "./abilityCatalog";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { isSessionInvalidated, readSession } from "./sessionCookie";

class SessionGuard implements AuthGuard {
  constructor(private readonly container: ServiceContainerLike) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const session = readSession(request);

    if (!session) {
      return null;
    }

    const tokenService = resolveAuthUserDirectory(this.container);

    if (!tokenService) {
      return null;
    }

    try {
      const user = await tokenService.findByIdOrThrow(session.userId);

      if (isSessionInvalidated(session.issuedAt, user.session_valid_after)) {
        return null;
      }

      return {
        id: user.id,
        role: user.role,
        abilities: resolveAbilitiesForRole(user.role),
        emailVerifiedAt: user.email_verified_at ?? null,
      };
    } catch {
      return null;
    }
  }
}

export { SessionGuard };
