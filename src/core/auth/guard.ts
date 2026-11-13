import { UnauthorizedError } from "@getstrata/core/errors/http";
import type { AuthBearerResolver } from "../contracts/authUserDirectory";
import { authorizationScheme, readBearerToken } from "../http/statelessAuth";
import { timingSafeCompareString } from "../security/timingSafeCompare";
import { isAuthUserActive } from "./accountState";
import type { AuthUser, CredentialSource } from "./authContext";
import { currentAuthUser, currentCredentialSource } from "./authContext";
import {
  type AuthOutcome,
  absentAuth,
  authenticatedAuth,
  authenticateProof,
  authUserFromOutcome,
  invalidAuth,
  validatedAuthOutcome,
} from "./authOutcome";
import { BasicAuthGuard } from "./basicAuthGuard";
import { JwtGuard } from "./jwtGuard";
import { requireAuthCapability } from "./requireAuthCapability";

/** Security composition consumes outcomes; concrete resolve methods are user-only conveniences. */
interface AuthGuard {
  authenticate(request: Request): AuthOutcome | Promise<AuthOutcome>;
}

class GuestGuard implements AuthGuard {
  constructor(
    private readonly options: {
      production: boolean;
      allowDevHeaders: boolean;
      abilities: { admin: readonly string[]; member: readonly string[] };
    },
  ) {}
  authenticate(request: Request): AuthOutcome {
    if (
      this.options.production ||
      !this.options.allowDevHeaders ||
      !request.headers.has("x-authenticated-user-id")
    )
      return absentAuth;
    const user = this.resolveUser(request);
    return user ? authenticatedAuth(user, "guest") : invalidAuth("guest");
  }
  resolve(request: Request): AuthUser | null {
    return authUserFromOutcome(this.authenticate(request));
  }
  private resolveUser(request: Request): AuthUser | null {
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

  authenticate(request: Request): AuthOutcome {
    if (authorizationScheme(request) !== "bearer") return absentAuth;
    const user = this.resolveUser(request);
    return user ? authenticatedAuth(user, "bearer") : invalidAuth("bearer");
  }
  resolve(request: Request): AuthUser | null {
    return authUserFromOutcome(this.authenticate(request));
  }
  private resolveUser(request: Request): AuthUser | null {
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

  authenticate(request: Request): Promise<AuthOutcome> {
    const token = readBearerToken(request);
    return authenticateProof(
      "bearer",
      authorizationScheme(request) === "bearer" && token?.split(".").length !== 3,
      () => this.resolveUser(request),
    );
  }
  async resolve(request: Request): Promise<AuthUser | null> {
    return authUserFromOutcome(await this.authenticate(request));
  }
  private async resolveUser(request: Request): Promise<AuthUser | null> {
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
  async authenticate(request: Request): Promise<AuthOutcome> {
    for (const guard of this.guards) {
      let outcome: AuthOutcome;
      try {
        outcome = validatedAuthOutcome(await guard.authenticate(request));
      } catch (error) {
        return { status: "error", user: null, credentialSource: null, error };
      }
      if (outcome.status !== "absent") return outcome;
    }
    return absentAuth;
  }
  async resolve(request: Request): Promise<AuthUser | null> {
    return authUserFromOutcome(await this.authenticate(request));
  }
}

const BEARER_GUARD_NAMES = ["api", "access_token", "token", "jwt"] as const;
const BASIC_GUARD_NAMES = ["basic"] as const;
const SESSION_GUARD_NAMES = ["web", "session", "default"] as const;

class AuthManager {
  private basicResolutions = new WeakMap<
    Request,
    { authorization: string | null; mfaCode: string | null; result: Promise<AuthOutcome> }
  >();
  private readonly namedGuards = new Map<string, AuthGuard>();
  constructor(private readonly guard: AuthGuard) {
    if (typeof guard?.authenticate !== "function")
      throw new TypeError("Auth guards require authenticate().");
    this.namedGuards.set("default", guard);
  }
  registerGuard(name: string, next: AuthGuard): this {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Auth guard name must not be empty.");
    if (typeof next.authenticate !== "function")
      throw new TypeError("Auth guards require authenticate().");
    this.namedGuards.set(trimmed, next);
    this.basicResolutions = new WeakMap();
    return this;
  }
  use(name = "default"): AuthGuard {
    const found = this.namedGuards.get(name);
    if (!found) throw new Error(`Unknown auth guard "${name}".`);
    return found;
  }
  guardNames(): string[] {
    return [...this.namedGuards.keys()];
  }
  async authenticate(request?: Request): Promise<AuthOutcome> {
    if (!request) {
      const user = currentAuthUser();
      return user ? authenticatedAuth(user, currentCredentialSource()) : absentAuth;
    }
    if (authorizationScheme(request) !== "basic") {
      this.basicResolutions.delete(request);
      return this.authenticateRequest(request);
    }
    const authorization = request.headers.get("authorization"),
      mfaCode = request.headers.get("x-mfa-code");
    const cached = this.basicResolutions.get(request);
    if (cached && cached.authorization === authorization && cached.mfaCode === mfaCode)
      return cached.result;
    const entry = { authorization, mfaCode, result: this.authenticateRequest(request) };
    this.basicResolutions.set(request, entry);
    const outcome = await entry.result;
    if (outcome.status === "error" && this.basicResolutions.get(request) === entry)
      this.basicResolutions.delete(request);
    return outcome;
  }
  /** User-only convenience; composition must consume authenticate(). */
  async resolve(request?: Request): Promise<AuthUser | null> {
    return authUserFromOutcome(await this.authenticate(request));
  }
  async resolveWithSource(
    request?: Request,
  ): Promise<{ user: AuthUser | null; credentialSource: CredentialSource }> {
    const outcome = await this.authenticate(request);
    const user = authUserFromOutcome(outcome);
    return { user, credentialSource: user ? outcome.credentialSource : null };
  }
  user(request?: Request): Promise<AuthUser | null> {
    return this.resolve(request);
  }
  async check(request?: Request): Promise<boolean> {
    return (await this.resolve(request)) !== null;
  }
  async requireUser(request?: Request): Promise<AuthUser> {
    const user = await this.resolve(request);
    if (!user) throw new UnauthorizedError();
    return user;
  }
  private async resolveGuard(guard: AuthGuard, request: Request): Promise<AuthOutcome> {
    try {
      const outcome = validatedAuthOutcome(await guard.authenticate(request));
      return outcome.status === "authenticated"
        ? authenticatedAuth(outcome.user, outcome.credentialSource)
        : outcome;
    } catch (error) {
      return { status: "error", user: null, credentialSource: null, error };
    }
  }
  private async authenticateRequest(request: Request): Promise<AuthOutcome> {
    const scheme = authorizationScheme(request);
    if (scheme === "bearer" || scheme === "basic") {
      const names = scheme === "bearer" ? BEARER_GUARD_NAMES : BASIC_GUARD_NAMES;
      const named = await this.tryNamedGuards(request, names);
      if (named.status !== "absent") return named;
      if (
        (scheme === "bearer" && isBearerCapableGuard(this.guard)) ||
        (scheme === "basic" && this.guard instanceof BasicAuthGuard)
      ) {
        const outcome = await this.resolveGuard(this.guard, request);
        if (outcome.status !== "absent") return outcome;
      }
      return invalidAuth(scheme);
    }
    if (scheme || request.headers.has("authorization")) return invalidAuth(null);
    return this.tryNamedGuards(request, SESSION_GUARD_NAMES);
  }
  private async tryNamedGuards(request: Request, names: readonly string[]): Promise<AuthOutcome> {
    const seen = new Set<AuthGuard>();
    for (const name of names) {
      const guard = this.namedGuards.get(name);
      if (!guard || seen.has(guard)) continue;
      seen.add(guard);
      const outcome = await this.resolveGuard(guard, request);
      if (outcome.status !== "absent") return outcome;
    }
    return absentAuth;
  }
}

function isBearerCapableGuard(guard: AuthGuard): boolean {
  return (
    guard instanceof ApiTokenGuard ||
    guard instanceof DatabaseTokenGuard ||
    guard instanceof JwtGuard
  );
}

export type { AuthGuard, AuthOutcome, AuthUser };
export {
  ApiTokenGuard,
  AuthManager,
  absentAuth,
  authenticatedAuth,
  authenticateProof,
  authUserFromOutcome,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
  invalidAuth,
  requireAuthCapability,
  validatedAuthOutcome,
};
