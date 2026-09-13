import {
  authNeedsUsers,
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  type StarterLayers,
} from "./types.ts";

function renderAuthDirectory(layers: StarterLayers): string | null {
  if (!authNeedsUsers(layers.auth)) {
    return null;
  }

  const tokenLookup = authUsesToken(layers.auth)
    ? `
  async resolveUserFromToken(token: string) {
    if (!token || token.split(".").length === 3) {
      return null;
    }
    const hashed = hashApiToken(token);
    const tokenRow = await runWithMigrationBypassForIdentifier(hashed, async () => {
      return await ApiToken.where({ token_hash: hashed }).first();
    });
    if (!tokenRow) {
      return null;
    }
    const expiresAt = tokenRow.get("expires_at");
    if (expiresAt && new Date(String(expiresAt)).getTime() <= Date.now()) {
      return null;
    }
    const user_id = Number(tokenRow.get("user_id"));
    const user = await runWithMigrationBypassForIdentifier(user_id, async () => {
      return await User.find(user_id);
    });
    if (!user) {
      return null;
    }
    let abilities: string[] = [];
    try {
      abilities = JSON.parse(String(tokenRow.get("abilities") ?? "[]")) as string[];
    } catch {
      abilities = [];
    }
    return {
      id: user_id,
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

  const hashImport = authUsesToken(layers.auth)
    ? `import { hashApiToken } from "@getstrata/core/auth/tokenHash";\n`
    : "";
  const apiTokenImport = authUsesToken(layers.auth)
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
${hashImport}import type { AuthUserDirectory, AuthUserRecord } from "@getstrata/core/contracts/authUserDirectory";
import { runWithMigrationBypassForIdentifier } from "@getstrata/core/tenant/databaseTenantContext";
${apiTokenImport}import { User } from "../models/User.ts";

type LoadedUser = {
  get(key: "id" | "name" | "email" | "is_admin" | "email_verified_at" | "password" | "session_valid_after"${mfaKeys}): unknown;
};

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

function asTimestamp(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null;
}
${nullableStringHelper}
function mapUserRow(user: LoadedUser): AuthUserRecord {
  return {
    id: Number(user.get("id")),
    name: String(user.get("name") ?? ""),
    email: String(user.get("email") ?? ""),
    role: mapRole(user.get("is_admin")),
    email_verified_at: asTimestamp(user.get("email_verified_at")),
    password: String(user.get("password") ?? ""),${mfaReturn}${sessionReturn}
  };
}

async function findUserById(id: number) {
  return await runWithMigrationBypassForIdentifier(id, async () => {
    const user = await User.find(id);
    if (!user) {
      throw new Error(\`User \${id} not found.\`);
    }
    return mapUserRow(user);
  });
}

async function findUserByEmail(email: string) {
  email = email.trim().toLowerCase();
  return await runWithMigrationBypassForIdentifier(email, async () => {
    const user = await User.where({ email }).first();
    return user ? mapUserRow(user) : null;
  });
}

export const starterAuthDirectory: AuthUserDirectory = {
${tokenLookup}

  findByIdOrThrow: findUserById,

  findByEmail: findUserByEmail,

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await findUserByEmail(email);
    if (!user?.password || !(await verifyPassword(password, user.password))) {
      return null;
    }
    if ("mfa_enabled" in user && user.mfa_enabled) {
      return null;
    }
    return {
      id: user.id,
      role: user.role,
      emailVerifiedAt: user.email_verified_at ?? null,
    };
  },
};
`;
}

function renderAuthProvider(layers: StarterLayers): string {
  if (layers.auth === "headers") {
    return `import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { envFlagEnabled } from "@getstrata/core/runtime/appEnv";

class StarterAuthManager {
  async resolveWithSource(request?: Request) {
    const user = await this.resolve(request);
    return { user, credentialSource: user ? "guest" as const : null };
  }

  async resolve(request?: Request): Promise<AuthUser | null> {
    if (!envFlagEnabled(process.env.AUTH_DEV_HEADERS)) {
      return request ? null : currentAuthUser();
    }
    if (request) {
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
    return currentAuthUser();
  }

  user(request?: Request) {
    return this.resolve(request);
  }

  async check(request: Request) {
    return (await this.user(request)) !== null;
  }
}

const authProvider: ServiceProvider = {
  name: "starter.auth",
  register({ container }) {
    container.set(CORE_AUTH_TOKEN, new StarterAuthManager());
  },
};

export default authProvider;
`;
  }

  const cookieBlock = authUsesCookie(layers.auth)
    ? `    const auth = createCookieSessionAuthManager({
      secret: sessionSecret(),
      cookieName: "strata_session",
      mapUser: (user) => ({
        id: user.id,
        role: user.is_admin ? "admin" : "member",
        ...(user.email_verified_at !== undefined ? { emailVerifiedAt: user.email_verified_at } : {}),
      }),
    });`
    : `    const fallback = ${
        authUsesToken(layers.auth) ? "new DatabaseTokenGuard(container)" : "new JwtGuard(container)"
      };
    const auth = new AuthManager(fallback);`;

  const tokenRegs = authUsesToken(layers.auth)
    ? `    const apiGuard = new DatabaseTokenGuard(container);
    auth.registerGuard("api", apiGuard);
    auth.registerGuard("access_token", apiGuard);
    auth.registerGuard("token", apiGuard);`
    : "";

  const jwtReg = authUsesJwt(layers.auth)
    ? `    auth.registerGuard("jwt", new JwtGuard(container));`
    : "";

  const basicReg =
    authUsesToken(layers.auth) || authUsesJwt(layers.auth)
      ? `    auth.registerGuard("basic", new BasicAuthGuard(container));`
      : "";

  const ability = authUsesToken(layers.auth)
    ? `    container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());`
    : "";

  const imports: string[] = [`import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";`];
  if (authUsesCookie(layers.auth)) {
    imports.push(
      `import { createCookieSessionAuthManager } from "@getstrata/bootstrap/web/session";`,
    );
  }
  if (authUsesToken(layers.auth) || authUsesJwt(layers.auth)) {
    imports.push(`import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";`);
  }
  if (!authUsesCookie(layers.auth) && authUsesToken(layers.auth)) {
    imports.push(`import { AuthManager, DatabaseTokenGuard } from "@getstrata/core/auth/guard";`);
  } else if (!authUsesCookie(layers.auth) && authUsesJwt(layers.auth)) {
    imports.push(`import { AuthManager } from "@getstrata/core/auth/guard";`);
  } else if (authUsesCookie(layers.auth) && authUsesToken(layers.auth)) {
    imports.push(`import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";`);
  }
  if (authUsesJwt(layers.auth)) {
    imports.push(`import { JwtGuard } from "@getstrata/core/auth/jwtGuard";`);
  }
  if (authUsesToken(layers.auth)) {
    imports.push(
      `import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";`,
    );
  }
  imports.push(`import type { ServiceProvider } from "@getstrata/core/contracts/di";`);
  const tokenImports = ["CORE_AUTH_USER_DIRECTORY_TOKEN"];
  if (authUsesToken(layers.auth)) {
    tokenImports.unshift("CORE_ABILITY_CHECKER_TOKEN");
  }
  imports.push(
    `import {\n  ${tokenImports.join(",\n  ")},\n} from "@getstrata/core/contracts/serviceTokens";`,
  );
  imports.push(`import { starterAuthDirectory } from "../authDirectory.ts";`);
  if (authUsesCookie(layers.auth)) {
    imports.push(`import { sessionSecret } from "../config.ts";`);
  }

  return `${imports.join("\n")}

const authProvider: ServiceProvider = {
  name: "starter.auth",
  register({ container }) {
    container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, starterAuthDirectory);
${cookieBlock}
${tokenRegs}
${jwtReg}
${basicReg}
${ability}
    container.set(CORE_AUTH_TOKEN, auth);
  },
};

export default authProvider;
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
