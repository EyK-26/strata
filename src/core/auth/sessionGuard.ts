import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { resolveAbilitiesForRole } from "./abilityCatalog";
import { isAccountActive, matchesAuthVersion } from "./accountState";
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

      if (!isAccountActive(user) || !matchesAuthVersion(session.authVersion, user.auth_version))
        return null;

      if (
        user.auth_version === undefined &&
        isSessionInvalidated(session.issuedAt, user.session_valid_after)
      ) {
        return null;
      }

      if (typeof tokenService.hasActiveBrowserSession === "function") {
        const active = await tokenService.hasActiveBrowserSession(session.userId, session.issuedAt);

        if (!active) {
          return null;
        }
      }

      return {
        id: user.id,
        role: user.role,
        ...(user.auth_version !== undefined ? { authVersion: user.auth_version } : {}),
        abilities: resolveAbilitiesForRole(user.role),
        emailVerifiedAt: user.email_verified_at ?? null,
      };
    } catch {
      return null;
    }
  }
}

export { SessionGuard };
