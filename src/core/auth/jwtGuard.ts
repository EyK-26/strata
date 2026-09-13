import type { AuthUserDirectory } from "../contracts/authUserDirectory";
import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { readBearerToken } from "../http/statelessAuth";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { type JwtPayload, verifyJwt } from "./jwt";
import { isSessionInvalidated } from "./sessionCookie";

interface JwtGuardOptions {
  secret?: string;
  directory?: AuthUserDirectory;
  container?: ServiceContainerLike;
}

function isServiceContainer(value: object): value is ServiceContainerLike {
  return (
    "has" in value &&
    "resolve" in value &&
    typeof (value as ServiceContainerLike).has === "function"
  );
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
  const userId =
    typeof payload.sub === "number" ? payload.sub : Number.parseInt(String(payload.sub), 10);

  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  return userId;
}

class JwtGuard implements AuthGuard {
  private readonly options: JwtGuardOptions;

  constructor(options: JwtGuardOptions | ServiceContainerLike = {}) {
    this.options = isServiceContainer(options) ? { container: options } : options;
  }

  async resolve(request: Request): Promise<AuthUser | null> {
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

    const directory =
      this.options.directory ??
      (this.options.container ? resolveAuthUserDirectory(this.options.container) : null);

    if (!directory) {
      return null;
    }

    const userId = jwtSubjectId(payload);
    if (userId === null) {
      return null;
    }

    let record: Awaited<ReturnType<AuthUserDirectory["findByIdOrThrow"]>>;
    try {
      record = await directory.findByIdOrThrow(userId);
    } catch {
      return null;
    }

    if (isSessionInvalidated(payload.iat * 1000, record.session_valid_after)) {
      return null;
    }

    return authUserFromJwt(payload);
  }
}

export type { JwtGuardOptions };
export { authUserFromJwt, JwtGuard };
