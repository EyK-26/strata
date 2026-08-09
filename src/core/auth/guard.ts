import type { ServiceContainer } from "../../bootstrap/contracts";
import { ADMIN_ABILITIES, MEMBER_ABILITIES } from "../../domain/abilities";
import { tokenServiceToken } from "../../modules/user/provider";
import type TokenService from "../../modules/user/tokenService";
import { UnauthorizedError } from "../errors/http";
import type { AuthUser } from "./authContext";
import { currentAuthUser } from "./authContext";

function devHeaderAbilities(role: string | null): string[] {
  if (role === "admin") {
    return [...ADMIN_ABILITIES];
  }

  return [...MEMBER_ABILITIES];
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

    return {
      id: userId,
      abilities: devHeaderAbilities(role),
      ...(role ? { role } : {}),
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
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return null;
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (token !== this.options.token) {
      return null;
    }

    return this.options.user;
  }
}

class DatabaseTokenGuard implements AuthGuard {
  constructor(private readonly container: ServiceContainer) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return null;
    }

    const token = authorization.slice("Bearer ".length).trim();

    if (!token) {
      return null;
    }

    if (!this.container.has(tokenServiceToken)) {
      return null;
    }

    const tokenService = this.container.resolve<TokenService>(tokenServiceToken);
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

class AuthManager {
  constructor(private readonly guard: AuthGuard) {}

  async resolve(request?: Request): Promise<AuthUser | null> {
    if (request) {
      return await Promise.resolve(this.guard.resolve(request));
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
}

export type { AuthGuard, AuthUser };
export { ApiTokenGuard, AuthManager, CompositeGuard, DatabaseTokenGuard, GuestGuard };
