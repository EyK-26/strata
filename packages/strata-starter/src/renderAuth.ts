import type { StarterFeaturePlan } from "./featurePlan.ts";

function renderAuthDirectory(plan: StarterFeaturePlan): string | null {
  const layers = plan.layers;
  if (!plan.decisions.users) {
    return null;
  }

  const tokenLookup = plan.decisions.token
    ? `
  async resolveUserFromToken(token: string) {
    if (!token || token.split(".").length === 3) {
      return null;
    }
    const hashed = hashApiToken(token);
    const tokenRow = await withAuthIdentifier(ports, hashed, async (database) => {
      return await database.model(ApiToken).where({ token_hash: hashed }).first();
    });
    if (!tokenRow) {
      return null;
    }
    const expiresAt = tokenRow.get("expires_at");
    if (expiresAt && new Date(String(expiresAt)).getTime() <= Date.now()) {
      return null;
    }
    const user_id = Number(tokenRow.get("user_id"));
    const user = await withAuthIdentifier(ports, user_id, async (database) => {
      return await database.model(User).find(user_id);
    });
    if (!user) {
      return null;
    }
    const record = mapUserRow(user);
    if (!record.is_active) return null;
    let abilities: string[] = [];
    try {
      abilities = JSON.parse(String(tokenRow.get("abilities") ?? "[]")) as string[];
    } catch {
      abilities = [];
    }
    return {
      id: user_id,
      isActive: record.is_active,
      authVersion: record.auth_version,
      role: mapRole(user.get("is_admin")),
      abilities,
      tokenId: Number(tokenRow.get("id")),
      emailVerifiedAt: asTimestamp(user.get("email_verified_at")),
    };
  },`
    : `
  async resolveUserFromToken() {
    return null;
  },`;

  const hashImport = plan.decisions.token
    ? `import { hashApiToken } from "@getstrata/core/auth/tokenHash";\n`
    : "";
  const apiTokenImport = plan.decisions.token
    ? `import { ApiToken } from "../models/ApiToken.ts";\n`
    : "";

  const mfaReturn = layers.extras.mfa
    ? `
    mfa_enabled: user.get("mfa_enabled") === true || user.get("mfa_enabled") === 1,
    mfa_secret: asNullableString(user.get("mfa_secret")),
    mfa_recovery_codes: asNullableString(user.get("mfa_recovery_codes")),`
    : "";
  const sessionReturn = `
    session_valid_after: asTimestamp(user.get("session_valid_after")),`;
  const nullableStringHelper = layers.extras.mfa
    ? `
function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
`
    : "";

  const mfaKeys = layers.extras.mfa ? ` | "mfa_enabled" | "mfa_secret" | "mfa_recovery_codes"` : "";

  return `import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import type { SelectedSession, ScopedPolicy } from "@getstrata/core/contracts/persistence";
${hashImport}import { AuthAccountNotFoundError, type AuthUserDirectory, type AuthUserRecord } from "@getstrata/core/contracts/authUserDirectory";

${apiTokenImport}import { User } from "../models/User.ts";

type LoadedUser = {
  get(key: "id" | "name" | "email" | "is_admin" | "email_verified_at" | "password" | "session_valid_after" | "is_active" | "auth_version"${mfaKeys}): unknown;
};

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

function asTimestamp(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null;
}
${nullableStringHelper}
export type StarterAuthUserRecord = AuthUserRecord & { is_active: boolean; auth_version: number };

function mapUserRow(user: LoadedUser): StarterAuthUserRecord {
  const active = user.get("is_active");
  const version = user.get("auth_version");
  if ((active !== true && active !== false && active !== 0 && active !== 1) || typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
    throw new Error("Account state missing or invalid. Apply the account-state migration before deploying auth readers.");
  }
  return {
    is_active: active === true || active === 1,
    auth_version: version,
    id: Number(user.get("id")),
    name: String(user.get("name") ?? ""),
    email: String(user.get("email") ?? ""),
    role: mapRole(user.get("is_admin")),
    email_verified_at: asTimestamp(user.get("email_verified_at")),
    password: String(user.get("password") ?? ""),${mfaReturn}${sessionReturn}
  };
}

export interface StarterAuthPersistence { readonly database: SelectedSession; readonly policy: ScopedPolicy }

export function withAuthIdentifier<T>(ports: StarterAuthPersistence, identifier: string | number, work: (database: SelectedSession) => T | Promise<T>): Promise<T> {
  if (!(typeof identifier === "number" ? Number.isSafeInteger(identifier) && identifier > 0 : typeof identifier === "string" && identifier.trim().length > 0)) throw new TypeError("Auth operation requires a validated row identifier.");
  return ${plan.decisions.rls ? 'ports.policy.run(ports.database, {kind: "identifier", identifier}, work)' : "ports.database.transaction(work)"};
}

export function createStarterAuthDirectory(ports: StarterAuthPersistence) {
async function findUserById(id: number) {
  return await withAuthIdentifier(ports, id, async (database) => {
    const user = await database.model(User).find(id);
    if (!user) {
      throw new AuthAccountNotFoundError();
    }
    return mapUserRow(user);
  });
}

async function findUserByEmail(email: string) {
  email = email.trim().toLowerCase();
  return await withAuthIdentifier(ports, email, async (database) => {
    const user = await database.model(User).where({ email }).first();
    return user ? mapUserRow(user) : null;
  });
}

return {
${tokenLookup}

  findByIdOrThrow: findUserById,

  findByEmail: findUserByEmail,

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await findUserByEmail(email);
    if (!user?.is_active || !user.password || !(await verifyPassword(password, user.password))) {
      return null;
    }
    if ("mfa_enabled" in user && user.mfa_enabled) {
      return null;
    }
    return {
      id: user.id,
      isActive: user.is_active,
      authVersion: user.auth_version,
      role: user.role,
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },
} satisfies AuthUserDirectory;
}

export async function runWithLockedAuthUser<T>(ports: StarterAuthPersistence, id: number, operation: (record: StarterAuthUserRecord | null, child: StarterAuthPersistence) => Promise<T>): Promise<T> {
  return withAuthIdentifier(ports, id, async (database) => {
    const user = await database.model(User).where({ id })${plan.decisions.rowLocks ? ".lockForUpdate()" : ""}.first();
    return operation(user ? mapUserRow(user) : null, { ...ports, database });
  });
}
`;
}

function renderAuthProvider(plan: StarterFeaturePlan): string {
  const users = plan.decisions.users;
  const cookie = plan.decisions.cookie;
  const mechanisms = plan.decisions.authMechanisms;
  return `import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import type { MetadataFactory } from "@getstrata/bootstrap/persistenceContracts";
${users ? 'import { createMetadataAuthManager, type MetadataAuthOptions } from "@getstrata/bootstrap/providers/auth";' : 'import type { MetadataAuthOptions } from "@getstrata/bootstrap/providers/auth";'}
${cookie ? 'import { createCookieSessionAuthManager, type CookieSessionAuthManager } from "@getstrata/bootstrap/web/session";\n' : ""}import { establishedAuthReader } from "@getstrata/core/auth/authReader";
${users ? 'import { persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";\n' : 'import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";\n'}import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import { csrfTokenOptionsFromEnvironment } from "@getstrata/core/http/csrfToken";
import type { OAuthStateOptions } from "@getstrata/core/security/oauthState";
${cookie ? 'import { createSamlServiceProvider, createSqlSamlAssertionReplayStore, readSamlEnvOptions, type SamlServiceProvider, type SamlServiceProviderConfig } from "@getstrata/core/auth/saml/samlServiceProvider";\n' : ""}${users ? 'import { Mailer, createMailDriver } from "@getstrata/core/mail/mailer";\nimport { requireConfiguredSecret } from "@getstrata/core/runtime/appKeyPrefix";\n' : ""}
import { ${cookie ? "passwordConfirmCookieName, passwordConfirmTtlSeconds, " : ""}type PasswordConfirmWriteOptions } from "@getstrata/core/auth/passwordConfirmCookie";
${plan.decisions.pendingMfa ? 'import { createPendingMfaHelpers } from "../pendingMfa.ts";\n' : ""}import { CORE_ABILITY_CHECKER_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { createServiceToken } from "@getstrata/core/contracts/token";
import type { ExecutionPersistence } from "@getstrata/core/contracts/persistence";
${plan.decisions.tenantTable ? 'import { resolveTenant } from "@getstrata/core/tenant/resolveTenant";\n' : ""}${users ? 'import { createStarterAuthDirectory, withAuthIdentifier, type StarterAuthPersistence } from "../authDirectory.ts";\n' : ""}${plan.decisions.tenantUsers ? 'import { User } from "../../models/User.ts";\n' : ""}
export type StarterAuthServicesOptions = Omit<MetadataAuthOptions, "mechanisms" | "sessionGuard"> & { readonly environment:Readonly<Record<string,string|undefined>>; readonly sessionSecret?: string; readonly signatureSecret?:string; readonly oauthStateSecret?:string; readonly passwordConfirmation?:PasswordConfirmWriteOptions };
export interface StarterAuthRuntime {
  readonly registrationEnabled: boolean;
  readonly scimEnabled: boolean;
  readonly redisUrl: string | undefined;
  readonly samlEnabled: boolean;
  readonly oauthEnabled: boolean;
  readonly appName: string;
  readonly appUrl: string;${cookie ? "\n  readonly saml: Readonly<SamlServiceProviderConfig> | undefined;" : ""}
  readonly github: Readonly<{clientId:string;clientSecret:string;redirectUri:string}>;
  readonly oidc: Readonly<{issuer:string;clientId:string;clientSecret:string;redirectUri:string}>;
  readonly tokenExpiryDays: number | null;
  readonly jwtTtlSeconds: number;
  readonly jwtSecret: string;
  readonly signatureSecret: string;
  readonly oauth: OAuthStateOptions;
  readonly passwordConfirmation: PasswordConfirmWriteOptions;
}
export interface StarterAuthServices {
  readonly config: StarterAuthRuntime;${users ? "\n  readonly mail: Mailer;" : ""}${cookie ? "\n  readonly saml: (ports:StarterAuthPersistence) => SamlServiceProvider;" : ""}${plan.decisions.pendingMfa ? "\n  readonly pendingMfa: ReturnType<typeof createPendingMfaHelpers>;" : ""}
  readonly csrf: ReturnType<typeof csrfTokenOptionsFromEnvironment>;
  readonly metadata: MetadataFactory;${users ? "\n  readonly directory: (ports: StarterAuthPersistence) => ReturnType<typeof createStarterAuthDirectory>;" : ""}${cookie ? "\n  readonly session: (ports: StarterAuthPersistence) => CookieSessionAuthManager;" : ""}
}
export const STARTER_AUTH_SERVICES = createServiceToken<StarterAuthServices>("starter.auth.services");
export function createStarterAuthServices(options: StarterAuthServicesOptions): StarterAuthServices {
  const env = Object.freeze({...options.environment});
  const snapshot = Object.freeze({ ...options, abilities: Object.freeze({ admin: Object.freeze([...options.abilities.admin]), member: Object.freeze([...options.abilities.member]) }) });
  ${users ? "const secretsEnv = Object.freeze({...env,...(snapshot.sessionSecret ? {SESSION_SECRET:snapshot.sessionSecret} : {})});" : ""}
  ${plan.decisions.jwt ? 'if (!snapshot.jwtSecret.trim()) throw new TypeError("An explicit JWT secret is required.");' : ""}
  const configuredAppUrl = env.APP_URL ?? "http://localhost:3000";
  const appUrl = configuredAppUrl.endsWith("/") ? configuredAppUrl.slice(0, -1) : configuredAppUrl;
  const config: StarterAuthRuntime = Object.freeze({
    registrationEnabled: (env.FEATURE_REGISTRATION ?? "true") !== "false",
    scimEnabled: (env.FEATURE_SCIM ?? "false") === "true", redisUrl:env.REDIS_URL,
    samlEnabled: env.FEATURE_SAML === "true",
    oauthEnabled: env.FEATURE_OAUTH === "true",
    appName: env.APP_NAME ?? "Strata", appUrl,${cookie ? '\n    saml: env.FEATURE_SAML === "true" ? Object.freeze(readSamlEnvOptions(env)) : undefined,' : ""}
    github: Object.freeze({clientId:env.GITHUB_CLIENT_ID?.trim() ?? "",clientSecret:env.GITHUB_CLIENT_SECRET?.trim() ?? "",redirectUri:env.GITHUB_REDIRECT_URI?.trim() || appUrl + "/auth/github/callback"}),
    oidc: Object.freeze({issuer:env.OIDC_ISSUER?.trim() ?? "",clientId:env.OIDC_CLIENT_ID?.trim() ?? "",clientSecret:env.OIDC_CLIENT_SECRET?.trim() ?? "",redirectUri:env.OIDC_REDIRECT_URI?.trim() || appUrl + "/auth/oidc/callback"}),
    tokenExpiryDays: ${plan.decisions.token ? '(() => { const days=Number.parseInt(env.API_TOKEN_DEFAULT_EXPIRY_DAYS?.trim() ?? "",10); return Number.isInteger(days) && days > 0 ? days : null; })()' : "null"},
    jwtTtlSeconds: ${plan.decisions.jwt ? '(() => { const ttl=Number.parseInt(env.JWT_TTL_SECONDS ?? "",10); return Number.isInteger(ttl) && ttl > 0 ? ttl : 3600; })()' : "3600"}, jwtSecret:snapshot.jwtSecret,
    signatureSecret: ${plan.decisions.signedUrls ? 'options.signatureSecret ?? requireConfiguredSecret(["SIGNED_URL_SECRET","SESSION_SECRET","OAUTH_STATE_SECRET"],"signed-url-secret",secretsEnv)' : "options.signatureSecret ?? snapshot.jwtSecret"},
    oauth: Object.freeze({secret:${cookie ? 'options.oauthStateSecret ?? requireConfiguredSecret(["OAUTH_STATE_SECRET","SESSION_SECRET"],"oauth-state-secret",secretsEnv)' : "options.oauthStateSecret ?? snapshot.jwtSecret"},production:snapshot.production}),
    passwordConfirmation: Object.freeze(options.passwordConfirmation ? {...options.passwordConfirmation} : {secret:${cookie ? 'requireConfiguredSecret(["SESSION_SECRET","OAUTH_STATE_SECRET"],"session-secret",secretsEnv)' : "snapshot.jwtSecret"},cookieName:${cookie ? "passwordConfirmCookieName(env)" : JSON.stringify("strata_password_confirmed")},ttlSeconds:${cookie ? "passwordConfirmTtlSeconds(env)" : "10800"},production:snapshot.production}),
  });
  ${cookie ? `if (!snapshot.sessionSecret?.trim()) throw new TypeError("SESSION_SECRET is required for cookie authentication.");\n  const session = (ports: StarterAuthPersistence) => createCookieSessionAuthManager({ selected: ports.database, policy: ports.policy, secret: snapshot.sessionSecret!, production: snapshot.production, rls: ${String(plan.decisions.rls)}, cookieName: "strata_session", mapUser: user => ({ id: user.id, name: user.name, email: user.email, authVersion: user.auth_version, isActive: user.is_active, role: user.is_admin ? "admin" : "member", ...(user.email_verified_at !== undefined ? {emailVerifiedAt:user.email_verified_at} : {}) }) });` : ""}
  const metadata: MetadataFactory = (${users || plan.decisions.tenantTable ? "ports" : "_ports"}: ExecutionPersistence) => {
    ${
      users
        ? `const directory = createStarterAuthDirectory(ports);
    const auth = createMetadataAuthManager(directory, { ...snapshot, mechanisms: ${JSON.stringify(mechanisms)}${cookie ? ", sessionGuard: session(ports)" : ""} }, async (record, hash) => {
      await withAuthIdentifier(ports, record.id, database => persistConsumedRecoveryHash(database, record.id, record.mfa_recovery_codes, hash));
      return true;
    });`
        : "const auth = new AuthManager(new GuestGuard(snapshot));"
    }
    return {
      authenticate: request => auth.authenticate(request),
      // The starter schema has no organization-membership table.
      memberships: async () => Object.freeze([]),
      userTenantId: ${
        plan.decisions.tenantUsers
          ? `id => withAuthIdentifier(ports, id, async database => {
        const user = await database.model(User).findOrFail(id);
        const tenant = Number(user.get("tenant_id"));
        if (!Number.isSafeInteger(tenant) || tenant <= 0) throw new Error("Account tenant identity is invalid.");
        return tenant;
      })`
          : "async () => 1"
      },
      tenant: ${plan.decisions.tenantTable ? "id => resolveTenant(ports.database, id)" : 'async id => ({id,slug:"default"})'},
    };
  };
  return Object.freeze({ config, metadata, csrf:csrfTokenOptionsFromEnvironment(env)${users ? ", mail: new Mailer(createMailDriver(env))" : ""}${cookie ? ', saml: (ports:StarterAuthPersistence) => { if(!config.saml) throw new Error("SAML is not configured.");return createSamlServiceProvider({...config.saml,replayStore:createSqlSamlAssertionReplayStore(ports.database)}); }' : ""}${plan.decisions.pendingMfa ? ", pendingMfa: createPendingMfaHelpers({secret:snapshot.sessionSecret!,production:snapshot.production})" : ""}${users ? ", directory: createStarterAuthDirectory" : ""}${cookie ? ", session" : ""} });
}
export function createStarterAuthProvider(services: StarterAuthServices): ServiceProvider {
  return {
    name: "starter.auth",
    register({ container }) {
      container.set(STARTER_AUTH_SERVICES, services);
      container.set(CORE_AUTH_TOKEN, establishedAuthReader);
      container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());
    },
  };
}
`;
}

export {
  renderAuthModule,
  renderPendingMfaTs,
  renderSiteModule,
} from "./renderAuthFlows.ts";
export {
  renderConfirmPasswordView,
  renderForgotPasswordView,
  renderHomeView,
  renderLayout,
  renderLoginView,
  renderMfaChallengeView,
  renderMfaSetupView,
  renderRegisterView,
  renderResetPasswordView,
  renderSiteCss,
  renderVerifyEmailView,
} from "./renderAuthViews.ts";
export { renderAuthDirectory, renderAuthProvider };
