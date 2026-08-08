import { UnauthorizedError } from "../errors/http";
import { currentAuthUser } from "./authContext";
import type { AuthUser } from "./authContext";

interface AuthGuard {
  resolve(request: Request): AuthUser | null;
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

class AuthManager {
  constructor(private readonly guard: AuthGuard) {}

  resolve(request?: Request): AuthUser | null {
    if (request) {
      return this.guard.resolve(request);
    }

    return currentAuthUser();
  }

  user(request?: Request): AuthUser | null {
    return this.resolve(request);
  }

  check(request?: Request): boolean {
    return this.user(request) !== null;
  }

  requireUser(request?: Request): AuthUser {
    const user = this.user(request);

    if (!user) {
      throw new UnauthorizedError();
    }

    return user;
  }
}

export { ApiTokenGuard, AuthManager, GuestGuard };
export type { AuthGuard, AuthUser };
