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
    const rows = await getSql().unsafe<
      {
        id: number;
        user_id: number;
        abilities: string;
        expires_at: Date | string | null;
        role?: string;
        is_admin?: number | boolean;
        email_verified_at?: Date | string | null;
      }
    >(
      \`SELECT t.id, t.user_id, t.abilities, t.expires_at, u.is_admin, u.email_verified_at
       FROM api_tokens t INNER JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?\`,
      [hashed],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }
    let abilities: string[] = [];
    try {
      abilities = JSON.parse(String(row.abilities ?? "[]")) as string[];
    } catch {
      abilities = ["profile:read"];
    }
    return {
      id: Number(row.user_id),
      role: row.is_admin ? "admin" : "member",
      abilities,
      tokenId: Number(row.id),
      emailVerifiedAt: row.email_verified_at ?? null,
    };
  },`
    : `
  async resolveUserFromToken() {
    return null;
  },`;

  const placeholder = layers.database === "postgres" ? "$1" : "?";

  const hashImport = authUsesToken(layers.auth)
    ? `import { hashApiToken } from "@getstrata/core/auth/tokenHash";\n`
    : "";

  const mfaSelect = layers.extras.mfa ? ", mfa_enabled, mfa_secret, mfa_recovery_codes" : "";
  const mfaColumns = layers.extras.mfa
    ? `
  mfa_enabled?: number | boolean;
  mfa_secret?: string | null;
  mfa_recovery_codes?: string | null;`
    : "";
  const mfaReturn = layers.extras.mfa
    ? `
    mfa_enabled: row.mfa_enabled === true || row.mfa_enabled === 1,
    mfa_secret: row.mfa_secret ?? null,
    mfa_recovery_codes: row.mfa_recovery_codes ?? null,`
    : "";
  const userColumns = `id, name, email, is_admin, email_verified_at, password${mfaSelect}`;

  return `import type { AuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
${hashImport}import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { getSql } from "./database.ts";

type UserRow = {
  id: number;
  name: string;
  email: string;
  is_admin: number | boolean;
  email_verified_at: Date | string | null;
  password: string;${mfaColumns}
};

function mapRole(isAdmin: unknown): string {
  return isAdmin === true || isAdmin === 1 || isAdmin === "1" ? "admin" : "member";
}

function mapUserRow(row: UserRow) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: mapRole(row.is_admin),
    email_verified_at: row.email_verified_at ?? null,
    password: row.password,${mfaReturn}
  };
}

async function findUserById(id: number) {
  const rows = await getSql().unsafe<UserRow>(
    "SELECT ${userColumns} FROM users WHERE id = ${placeholder}",
    [id],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(\`User \${id} not found.\`);
  }
  return mapUserRow(row);
}

async function findUserByEmail(email: string) {
  const rows = await getSql().unsafe<UserRow>(
    "SELECT ${userColumns} FROM users WHERE email = ${placeholder}",
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  return row ? mapUserRow(row) : null;
}

export const starterAuthDirectory: AuthUserDirectory = {
${tokenLookup.replace("WHERE t.token_hash = ?", `WHERE t.token_hash = ${placeholder}`)}

  findByIdOrThrow: findUserById,

  findByEmail: findUserByEmail,

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    const user = await findUserByEmail(email);
    if (!user?.password || !(await verifyPassword(password, user.password))) {
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
        authUsesToken(layers.auth) ? "new DatabaseTokenGuard(container)" : "new JwtGuard()"
      };
    const auth = new AuthManager(fallback);`;

  const tokenRegs = authUsesToken(layers.auth)
    ? `    const apiGuard = new DatabaseTokenGuard(container);
    auth.registerGuard("api", apiGuard);
    auth.registerGuard("access_token", apiGuard);
    auth.registerGuard("token", apiGuard);`
    : "";

  const jwtReg = authUsesJwt(layers.auth) ? `    auth.registerGuard("jwt", new JwtGuard());` : "";

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
