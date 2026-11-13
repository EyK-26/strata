import { UnauthorizedError } from "@getstrata/core/errors/http";
import type { AuthBearerResolver } from "../contracts/authUserDirectory";
import { authorizationScheme, readBearerToken } from "../http/statelessAuth";
import { timingSafeCompareString } from "../security/timingSafeCompare";
import { isAuthUserActive } from "./accountState";
import type { AuthUser, CredentialSource } from "./authContext";
import { currentAuthUser } from "./authContext";
import { BasicAuthGuard } from "./basicAuthGuard";
import { JwtGuard } from "./jwtGuard";
import { requireAuthCapability } from "./requireAuthCapability";

interface AuthGuard {
  resolve(request: Request): AuthUser | null | Promise<AuthUser | null>;
}

class GuestGuard implements AuthGuard {
  constructor(
    private readonly options: {
      production: boolean;
      allowDevHeaders: boolean;
      abilities: { admin: readonly string[]; member: readonly string[] };
    },
  ) {}
  resolve(request: Request): AuthUser | null {
    if (this.options.production) {
      return null;
    }

    if (!this.options.allowDevHeaders) {
      return null;
    }

    const userId = request.headers.get("x-authenticated-user-id");

    if (!userId) {
      return null;
    }

    const role = request.headers.get("x-authenticated-user-role");
    const verified = request.headers.get("x-authenticated-email-verified");

    return {
      id: userId,
      abilities: [
        ...(role === "admin" ? this.options.abilities.admin : this.options.abilities.member),
      ],
      ...(role ? { role } : {}),
      emailVerifiedAt: verified === "true" ? new Date(0) : null,
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

    if (!token || !timingSafeCompareString(token, this.options.token)) {
      return null;
    }

    return isAuthUserActive(this.options.user) ? this.options.user : null;
  }
}

class DatabaseTokenGuard implements AuthGuard {
  constructor(private readonly tokens: AuthBearerResolver) {
    requireAuthCapability<AuthBearerResolver>(tokens, ["resolveUserFromToken"], "API token");
  }

  async resolve(request: Request): Promise<AuthUser | null> {
    const token = readBearerToken(request);

    if (!token || token.split(".").length === 3) {
      return null;
    }

    const user = await this.tokens.resolveUserFromToken(token);
    return user && isAuthUserActive(user) ? user : null;
  }
}

class CompositeGuard implements AuthGuard {
  constructor(private readonly guards: AuthGuard[]) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    return (await this.resolveWithSource(request)).user;
  }
  async resolveWithSource(
    request: Request,
  ): Promise<{ user: AuthUser | null; credentialSource: CredentialSource }> {
    for (const guard of this.guards) {
      const user = await guard.resolve(request);
      if (user && isAuthUserActive(user))
        return { user, credentialSource: guard instanceof GuestGuard ? "guest" : "session" };
    }
    return { user: null, credentialSource: null };
  }
}

const BEARER_GUARD_NAMES = ["api", "access_token", "token", "jwt"] as const;
const BASIC_GUARD_NAMES = ["basic"] as const;
const SESSION_GUARD_NAMES = ["web", "session", "default"] as const;

class AuthManager {
  // A Basic recovery code is a single-use proof, not a repeatable lookup.
  // Weak keys limit reuse to the actual Request, never a later HTTP request.
  private basicResolutions = new WeakMap<
    Request,
    {
      authorization: string | null;
      mfaCode: string | null;
      result: Promise<{ user: AuthUser | null; credentialSource: CredentialSource }>;
    }
  >();
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
    this.basicResolutions = new WeakMap();
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
    const result = await this.resolveWithSource(request);
    return result.user;
  }

  async resolveWithSource(
    request?: Request,
  ): Promise<{ user: AuthUser | null; credentialSource: CredentialSource }> {
    if (!request) {
      const user = currentAuthUser();
      return { user: user && isAuthUserActive(user) ? user : null, credentialSource: null };
    }

    if (authorizationScheme(request) !== "basic") {
      this.basicResolutions.delete(request);
      return await this.authenticateRequest(request);
    }
    const authorization = request.headers.get("authorization");
    const mfaCode = request.headers.get("x-mfa-code");
    const cached = this.basicResolutions.get(request);
    if (cached && cached.authorization === authorization && cached.mfaCode === mfaCode) {
      return await cached.result;
    }
    const entry = { authorization, mfaCode, result: this.authenticateRequest(request) };
    this.basicResolutions.set(request, entry);
    try {
      return await entry.result;
    } catch (error) {
      if (this.basicResolutions.get(request) === entry) this.basicResolutions.delete(request);
      throw error;
    }
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

  private async resolveGuard(guard: AuthGuard, request: Request): Promise<AuthUser | null> {
    const user = await guard.resolve(request);
    return user && isAuthUserActive(user) ? user : null;
  }

  private async authenticateRequest(
    request: Request,
  ): Promise<{ user: AuthUser | null; credentialSource: CredentialSource }> {
    const scheme = authorizationScheme(request);

    if (scheme === "bearer") {
      const fromNamed = await this.tryNamedGuards(request, BEARER_GUARD_NAMES, "bearer");
      if (fromNamed) {
        return fromNamed;
      }

      if (isBearerCapableGuard(this.guard)) {
        const fromDefault = await this.resolveGuard(this.guard, request);
        return { user: fromDefault, credentialSource: fromDefault ? "bearer" : null };
      }

      return { user: null, credentialSource: null };
    }

    if (scheme === "basic") {
      const fromNamed = await this.tryNamedGuards(request, BASIC_GUARD_NAMES, "basic");
      if (fromNamed) {
        return fromNamed;
      }

      if (this.guard instanceof BasicAuthGuard) {
        const fromDefault = await this.resolveGuard(this.guard, request);
        return { user: fromDefault, credentialSource: fromDefault ? "basic" : null };
      }

      return { user: null, credentialSource: null };
    }

    const fromSession = await this.tryNamedGuards(request, SESSION_GUARD_NAMES, "session");
    if (fromSession) {
      return fromSession;
    }

    const fromDefault = await this.resolveGuard(this.guard, request);
    if (!fromDefault) {
      return { user: null, credentialSource: null };
    }

    const source: CredentialSource = this.guard instanceof GuestGuard ? "guest" : "session";
    return { user: fromDefault, credentialSource: source };
  }

  private async tryNamedGuards(
    request: Request,
    names: readonly string[],
    source: "session" | "bearer" | "basic",
  ): Promise<{ user: AuthUser; credentialSource: CredentialSource } | null> {
    const seen = new Set<AuthGuard>();

    for (const name of names) {
      const named = this.namedGuards.get(name);

      if (!named || seen.has(named)) {
        continue;
      }

      seen.add(named);
      if (source === "session" && named instanceof CompositeGuard) {
        const result = await named.resolveWithSource(request);
        if (result.user) return { user: result.user, credentialSource: result.credentialSource };
        continue;
      }
      const user = await this.resolveGuard(named, request);

      if (user) {
        return { user, credentialSource: named instanceof GuestGuard ? "guest" : source };
      }
    }

    return null;
  }
}

function isBearerCapableGuard(guard: AuthGuard): boolean {
  return (
    guard instanceof ApiTokenGuard ||
    guard instanceof DatabaseTokenGuard ||
    guard instanceof JwtGuard
  );
}

export type { AuthGuard, AuthUser };
export { ApiTokenGuard, AuthManager, CompositeGuard, DatabaseTokenGuard, GuestGuard };
