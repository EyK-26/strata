import { readBearerToken } from "../http/statelessAuth";
import type { AuthUser } from "./authContext";
import type { AuthGuard } from "./guard";
import { type JwtPayload, verifyJwt } from "./jwt";

interface JwtGuardOptions {
  secret?: string;
}

function authUserFromJwt(payload: JwtPayload): AuthUser {
  return {
    id: payload.sub,
    ...(payload.role ? { role: String(payload.role) } : {}),
    ...(Array.isArray(payload.abilities) ? { abilities: payload.abilities.map(String) } : {}),
    ...(payload.emailVerifiedAt !== undefined ? { emailVerifiedAt: payload.emailVerifiedAt } : {}),
  };
}

class JwtGuard implements AuthGuard {
  constructor(private readonly options: JwtGuardOptions = {}) {}

  resolve(request: Request): AuthUser | null {
    const token = readBearerToken(request);

    if (token?.split(".").length !== 3) {
      return null;
    }

    const payload = verifyJwt(token, this.options.secret);

    if (!payload) {
      return null;
    }

    return authUserFromJwt(payload);
  }
}

export type { JwtGuardOptions };
export { authUserFromJwt, JwtGuard };
