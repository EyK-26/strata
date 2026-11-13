import type { AuthAccountLookup, AuthSessionValidity } from "../contracts/authUserDirectory";
import { isAccountActive, matchesAuthVersion } from "./accountState";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { requireAuthCapability } from "./requireAuthCapability";
import { isSessionInvalidated, type readSession } from "./sessionCookie";

class SessionGuard implements AuthGuard {
  constructor(
    private readonly directory: AuthAccountLookup,
    private readonly session: {
      read(request: Request): ReturnType<typeof readSession>;
      abilities(role: string): string[];
      /** Null explicitly selects account epoch/cutoff validation without a session registry. */
      validity: AuthSessionValidity | null;
    },
  ) {
    requireAuthCapability<AuthAccountLookup>(directory, ["findByIdOrThrow"], "session account");
    requireAuthCapability<typeof session>(session, ["read", "abilities"], "session");
    if (session.validity !== null) {
      requireAuthCapability<AuthSessionValidity>(
        session.validity,
        ["hasActiveBrowserSession"],
        "session validity",
      );
    }
  }

  async resolve(request: Request): Promise<AuthUser | null> {
    const session = this.session.read(request);

    if (!session) {
      return null;
    }

    const accounts = this.directory;

    try {
      const user = await accounts.findByIdOrThrow(session.userId);

      if (!isAccountActive(user) || !matchesAuthVersion(session.authVersion, user.auth_version))
        return null;

      if (
        user.auth_version === undefined &&
        isSessionInvalidated(session.issuedAt, user.session_valid_after)
      ) {
        return null;
      }

      if (this.session.validity !== null) {
        const active = await this.session.validity.hasActiveBrowserSession(
          session.userId,
          session.issuedAt,
        );

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
