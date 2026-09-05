import { UnauthorizedError } from "@getstrata/core/errors/http";
import type { ServiceContainerLike } from "../contracts/serviceContainer";
import { resolveAuthUserDirectory } from "../contracts/serviceTokens";
import { authorizationScheme, readBearerToken } from "../http/statelessAuth";
import { abilityCatalog } from "./abilityCatalog";
import type { AuthUser } from "./authContext";
import { currentAuthUser } from "./authContext";

function devHeaderAbilities(role: string | null): string[] {
  const catalog = abilityCatalog();

  if (role === "admin") {
    return [...catalog.admin];
  }

  return [...catalog.member];
}

interface AuthGuard {
  resolve(request: Request): AuthUser | null | Promise<AuthUser | null>;
}

class GuestGuard implements AuthGuard {
  resolve(request: Request): AuthUser | null {
    const userId = request.headers.get("x-authenticated-user-id");

    if (!userId) {
      return null;
    }

    const role = request.headers.get("x-authenticated-user-role");
    const verified = request.headers.get("x-authenticated-email-verified");

    return {
      id: userId,
      abilities: devHeaderAbilities(role),
      ...(role ? { role } : {}),
      ...(verified === "false" ? { emailVerifiedAt: null } : {}),
    };
  }
}

class ApiTokenGuard implements AuthGuard {
  constructor(
    private readonly options: {
      token: string;
      user: AuthUser;
    },
  ) {}

  resolve(request: Request): AuthUser | null {
    const token = readBearerToken(request);

    if (!token || token !== this.options.token) {
      return null;
    }

    return this.options.user;
  }
}

class DatabaseTokenGuard implements AuthGuard {
  constructor(private readonly container: ServiceContainerLike) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const token = readBearerToken(request);

    if (!token || token.split(".").length === 3) {
      return null;
    }

    const tokenService = resolveAuthUserDirectory(this.container);

    if (!tokenService || typeof tokenService.resolveUserFromToken !== "function") {
      return null;
    }

    return await tokenService.resolveUserFromToken(token);
  }
}

class CompositeGuard implements AuthGuard {
  constructor(private readonly guards: AuthGuard[]) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    for (const guard of this.guards) {
      const user = await Promise.resolve(guard.resolve(request));

      if (user) {
        return user;
      }
    }

    return null;
  }
}

const BEARER_GUARD_NAMES = ["api", "access_token", "token", "jwt"] as const;
const BASIC_GUARD_NAMES = ["basic"] as const;
const SESSION_GUARD_NAMES = ["web", "session", "default"] as const;

class AuthManager {
  private readonly namedGuards = new Map<string, AuthGuard>();

  constructor(private readonly guard: AuthGuard) {
    this.namedGuards.set("default", guard);
  }

  registerGuard(name: string, next: AuthGuard): this {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error("Auth guard name must not be empty.");
    }

    this.namedGuards.set(trimmed, next);
    return this;
  }

  use(name = "default"): AuthGuard {
    const found = this.namedGuards.get(name);

    if (!found) {
      throw new Error(`Unknown auth guard "${name}".`);
    }

    return found;
  }

  guardNames(): string[] {
    return [...this.namedGuards.keys()];
  }

  async resolve(request?: Request): Promise<AuthUser | null> {
    if (request) {
      return await this.authenticateRequest(request);
    }

    return currentAuthUser();
  }

  user(request?: Request): Promise<AuthUser | null> {
    return this.resolve(request);
  }

  async check(request?: Request): Promise<boolean> {
    return (await this.user(request)) !== null;
  }

  async requireUser(request?: Request): Promise<AuthUser> {
    const user = await this.user(request);

    if (!user) {
      throw new UnauthorizedError();
    }

    return user;
  }

  private async authenticateRequest(request: Request): Promise<AuthUser | null> {
    const scheme = authorizationScheme(request);

    if (scheme === "bearer") {
      const fromBearer = await this.tryNamedGuards(request, BEARER_GUARD_NAMES);
      if (fromBearer) {
        return fromBearer;
      }
    } else if (scheme === "basic") {
      const fromBasic = await this.tryNamedGuards(request, BASIC_GUARD_NAMES);
      if (fromBasic) {
        return fromBasic;
      }
    } else {
      const fromSession = await this.tryNamedGuards(request, SESSION_GUARD_NAMES);
      if (fromSession) {
        return fromSession;
      }
    }

    return await Promise.resolve(this.guard.resolve(request));
  }

  private async tryNamedGuards(
    request: Request,
    names: readonly string[],
  ): Promise<AuthUser | null> {
    const seen = new Set<AuthGuard>();

    for (const name of names) {
      const named = this.namedGuards.get(name);

      if (!named || seen.has(named)) {
        continue;
      }

      seen.add(named);
      const user = await Promise.resolve(named.resolve(request));

      if (user) {
        return user;
      }
    }

    return null;
  }
}

export type { AuthGuard, AuthUser };
export { ApiTokenGuard, AuthManager, CompositeGuard, DatabaseTokenGuard, GuestGuard };
