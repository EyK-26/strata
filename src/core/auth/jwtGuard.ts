import type { AuthAccountLookup } from "../contracts/authUserDirectory";
import { authorizationScheme, readBearerToken } from "../http/statelessAuth";
import { isAccountActive, matchesAuthVersion } from "./accountState";
import type { AuthUser } from "./authContext";
import { type AuthOutcome, authenticateProof, authUserFromOutcome } from "./authOutcome";
import type { AuthGuard } from "./guard";
import { type JwtPayload, verifyJwt } from "./jwt";
import { requireAuthCapability } from "./requireAuthCapability";
import { isSessionInvalidated } from "./sessionCookie";

interface JwtGuardOptions {
  secret: string;
  directory: AuthAccountLookup;
}

function authUserFromJwt(payload: JwtPayload): AuthUser {
  return {
    id: payload.sub,
    ...(payload.role ? { role: String(payload.role) } : {}),
    ...(Array.isArray(payload.abilities) ? { abilities: payload.abilities.map(String) } : {}),
    ...(payload.emailVerifiedAt !== undefined ? { emailVerifiedAt: payload.emailVerifiedAt } : {}),
  };
}

function jwtSubjectId(payload: JwtPayload): number | null {
  if (typeof payload.sub === "string" && !/^[1-9]\d*$/.test(payload.sub)) return null;
  const userId = typeof payload.sub === "number" ? payload.sub : Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  return userId;
}

class JwtGuard implements AuthGuard {
  private readonly options: JwtGuardOptions;

  constructor(options: JwtGuardOptions) {
    requireAuthCapability<AuthAccountLookup>(options.directory, ["findByIdOrThrow"], "JWT");
    if (typeof options.secret !== "string" || !options.secret) {
      throw new TypeError("Explicit JWT secret is required.");
    }
    this.options = options;
  }

  authenticate(request: Request): Promise<AuthOutcome> {
    return authenticateProof(
      "bearer",
      authorizationScheme(request) === "bearer" &&
        (readBearerToken(request) === null || readBearerToken(request)?.split(".").length === 3),
      () => this.resolveUser(request),
    );
  }
  async resolve(request: Request): Promise<AuthUser | null> {
    return authUserFromOutcome(await this.authenticate(request));
  }
  private async resolveUser(request: Request): Promise<AuthUser | null> {
    const token = readBearerToken(request);

    if (token?.split(".").length !== 3) {
      return null;
    }

    const payload = verifyJwt(token, this.options.secret);

    if (!payload) {
      return null;
    }

    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
      return null;
    }

    const directory = this.options.directory;

    const userId = jwtSubjectId(payload);
    if (userId === null) {
      return null;
    }

    const record = await directory.findByIdOrThrow(userId);
    if (record.id !== userId) return null;

    if (!isAccountActive(record) || !matchesAuthVersion(payload.authVersion, record.auth_version))
      return null;

    if (
      record.auth_version === undefined &&
      isSessionInvalidated(payload.iat * 1000, record.session_valid_after)
    ) {
      return null;
    }

    return {
      ...authUserFromJwt(payload),
      id: record.id,
      ...(record.auth_version !== undefined ? { authVersion: record.auth_version } : {}),
    };
  }
}

export type { JwtGuardOptions };
export { authUserFromJwt, JwtGuard };
