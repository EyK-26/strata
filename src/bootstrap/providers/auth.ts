import { establishedAuthReader } from "@getstrata/core/auth/authReader";
import { BasicAuthGuard, type BasicAuthGuardOptions } from "@getstrata/core/auth/basicAuthGuard";
import {
  type AuthGuard,
  AuthManager,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
} from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { requireAuthCapability } from "@getstrata/core/auth/requireAuthCapability";
import type { readSession } from "@getstrata/core/auth/sessionCookie";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import type {
  AuthAccountLookup,
  AuthBearerResolver,
  AuthCredentialVerifier,
  AuthEmailLookup,
  AuthSessionValidity,
  AuthUserDirectory,
  AuthUserRecord,
} from "@getstrata/core/contracts/authUserDirectory";
import { CORE_AUTH_TOKEN } from "../config";
import type { ServiceProvider } from "../contracts";

export interface MetadataAuthOptions {
  readonly mechanisms: readonly ("api" | "jwt" | "basic" | "session")[];
  readonly sessionGuard?: AuthGuard;
  readonly production: boolean;
  readonly allowDevHeaders: boolean;
  readonly jwtSecret: string;
  readonly readSession: (request: Request) => ReturnType<typeof readSession>;
  readonly abilities: { readonly admin: readonly string[]; readonly member: readonly string[] };
  readonly roleAbilities: (role: string) => string[];
}
/** Construct once for each metadata invocation, with invocation-bound narrow ports. */
export function createMetadataAuthManager(
  directory: Partial<AuthUserDirectory>,
  options: MetadataAuthOptions,
  persistRecovery: (record: AuthUserRecord, hash: string) => Promise<boolean>,
): AuthManager {
  const enabled = new Set(options.mechanisms);
  if ([...enabled].some((name) => !["api", "jwt", "basic", "session"].includes(name)))
    throw new TypeError("Unknown authentication mechanism.");
  const named = new Map<string, AuthGuard>();
  const guards: AuthGuard[] = [];
  const add = (name: string, guard: AuthGuard) => {
    named.set(name, guard);
    guards.push(guard);
    return guard;
  };
  if (enabled.has("api")) {
    const api = add(
      "api",
      new DatabaseTokenGuard(
        requireAuthCapability<AuthBearerResolver>(directory, ["resolveUserFromToken"], "API token"),
      ),
    );
    named.set("access_token", api);
  }
  if (enabled.has("jwt")) {
    if (!options.jwtSecret) throw new TypeError("Explicit JWT secret is required.");
    add(
      "jwt",
      new JwtGuard({
        directory: requireAuthCapability<AuthAccountLookup>(directory, ["findByIdOrThrow"], "JWT"),
        secret: options.jwtSecret,
      }),
    );
  }
  if (enabled.has("basic")) {
    const accounts = requireAuthCapability<AuthAccountLookup>(
      directory,
      ["findByIdOrThrow"],
      "Basic account",
    );
    const emailLookup =
      directory.findByEmail === undefined
        ? undefined
        : requireAuthCapability<AuthEmailLookup>(directory, ["findByEmail"], "Basic email lookup");
    const credentials =
      directory.verifyCredentials === undefined
        ? undefined
        : requireAuthCapability<AuthCredentialVerifier>(
            directory,
            ["verifyCredentials"],
            "Basic credentials",
          );
    let basic: BasicAuthGuardOptions;
    if (emailLookup) basic = { accounts, emailLookup, credentials, persistRecovery };
    else if (credentials) basic = { accounts, credentials, persistRecovery };
    else
      throw new TypeError("Basic authentication requires an email lookup or credential verifier.");
    add("basic", new BasicAuthGuard(basic));
  }
  if (enabled.has("session")) {
    const session = add(
      "web",
      options.sessionGuard !== undefined
        ? requireAuthCapability<AuthGuard>(options.sessionGuard, ["resolve"], "custom session")
        : new SessionGuard(
            requireAuthCapability<AuthAccountLookup>(
              directory,
              ["findByIdOrThrow"],
              "session account",
            ),
            {
              read: options.readSession,
              abilities: options.roleAbilities,
              validity:
                directory.hasActiveBrowserSession === undefined
                  ? null
                  : requireAuthCapability<AuthSessionValidity>(
                      directory,
                      ["hasActiveBrowserSession"],
                      "session validity",
                    ),
            },
          ),
    );
    named.set("session", session);
  }
  if (!options.production && options.allowDevHeaders)
    guards.push(new GuestGuard({ ...options, abilities: options.abilities }));
  const auth = new AuthManager(new CompositeGuard(guards));
  for (const [name, guard] of named) auth.registerGuard(name, guard);
  return auth;
}
const authProvider: ServiceProvider = {
  name: "core.auth",
  register({ container }) {
    container.set(CORE_AUTH_TOKEN, establishedAuthReader);
  },
};
export default authProvider;
