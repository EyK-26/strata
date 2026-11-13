import type { AuthUserDirectory } from "../contracts/authUserDirectory";
import { isAccountActive, matchesAuthVersion } from "./accountState";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { isSessionInvalidated, type readSession } from "./sessionCookie";

class SessionGuard implements AuthGuard {
  constructor(
    private readonly directory: AuthUserDirectory,
    private readonly session: {
      read(request: Request): ReturnType<typeof readSession>;
      abilities(role: string): string[];
    },
  ) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const session = this.session.read(request);

    if (!session) {
      return null;
    }

    const tokenService = this.directory;

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
        abilities: this.session.abilities(user.role),
        emailVerifiedAt: user.email_verified_at ?? null,
      };
    } catch {
      return null;
    }
  }
}

export { SessionGuard };
