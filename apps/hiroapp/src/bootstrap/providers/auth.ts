import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import {
  createCookieSessionAuthManager,
  type LoadSessionUser,
  type SessionUser,
} from "@getstrata/bootstrap/web/session";
import { configureAbilityCatalog } from "@getstrata/core/auth/abilityCatalog";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
} from "@getstrata/core/contracts/serviceTokens";
import { appCookieName } from "@getstrata/core/runtime/appKeyPrefix";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { roleName } from "../../lib/roles.ts";
import { hiroAuthDirectory } from "../authDirectory.ts";

export type HiroSessionUser = SessionUser & {
  first_name: string;
  last_name: string;
  role_id: number;
  email_verified_at?: Date | string | null;
};

const loadSessionUser: LoadSessionUser = async (sql, sessionId) => {
  const rows = await runWithMigrationBypass(() =>
    sql.unsafe<
      Array<{
        user_id: number;
        first_name: string;
        last_name: string;
        email: string;
        role_id: number;
        email_verified_at: Date | string | null;
      }>
    >(
      `SELECT s.user_id, u.first_name, u.last_name, u.email, u.role_id, u.email_verified_at
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sessionId],
    ),
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  const roleId = Number(row.role_id);
  return {
    id: Number(row.user_id),
    name: `${row.first_name} ${row.last_name}`,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role_id: roleId,
    is_admin: roleId === 1,
    email_verified_at: row.email_verified_at ?? null,
  } as HiroSessionUser;
};

function mapUser(user: SessionUser): AuthUser {
  const hiro = user as HiroSessionUser;
  return {
    id: user.id,
    role: roleName(hiro.role_id ?? (user.is_admin ? 1 : 2)),
    emailVerifiedAt: hiro.email_verified_at ?? null,
  };
}

export const authProvider: ServiceProvider = {
  name: "hiroapp.auth",
  register({ container }) {
    configureAbilityCatalog({
      member: ["profile:read"],
      admin: ["*"],
      resolveForRole(role) {
        if (role === "admin") {
          return ["*"];
        }
        if (role === "recruiter") {
          return [
            "profile:read",
            "applications:read",
            "applications:write",
            "integrations:ping",
            "auth:tokens:read",
            "auth:tokens:write",
            "auth:tokens:delete",
          ];
        }
        return ["profile:read"];
      },
    });
    container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, hiroAuthDirectory);
    const auth = createCookieSessionAuthManager({
      secret: process.env.SESSION_SECRET?.trim() || "hiroapp-dev-session-secret-change-me",
      cookieName: appCookieName("session"),
      loadSessionUser,
      mapUser,
    });
    const apiGuard = new DatabaseTokenGuard(container);
    auth.registerGuard("api", apiGuard);
    auth.registerGuard("access_token", apiGuard);
    auth.registerGuard("jwt", new JwtGuard());
    auth.registerGuard("basic", new BasicAuthGuard(container));
    container.set(CORE_ABILITY_CHECKER_TOKEN, createTokenAbilityChecker());
    container.set(CORE_AUTH_TOKEN, auth);
  },
};
