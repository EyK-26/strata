import type { ServiceProvider } from "@getstrata/bootstrap/contracts";
import {
  createCookieSessionAuthManager,
  type LoadSessionUser,
  type SessionUser,
} from "@getstrata/bootstrap/web/session";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { CORE_AUTH_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { appCookieName } from "@getstrata/core/runtime/appKeyPrefix";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { roleName } from "../../lib/roles.ts";

export type HiroSessionUser = SessionUser & {
  first_name: string;
  last_name: string;
  role_id: number;
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
      }>
    >(
      `SELECT s.user_id, u.first_name, u.last_name, u.email, u.role_id
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
  } as HiroSessionUser;
};

function mapUser(user: SessionUser): AuthUser {
  const hiro = user as HiroSessionUser;
  return {
    id: user.id,
    role: roleName(hiro.role_id ?? (user.is_admin ? 1 : 2)),
  };
}

export const authProvider: ServiceProvider = {
  name: "hiroapp.auth",
  register({ container }) {
    const auth = createCookieSessionAuthManager({
      secret: process.env.SESSION_SECRET?.trim() || "hiroapp-dev-session-secret-change-me",
      cookieName: appCookieName("session"),
      loadSessionUser,
      mapUser,
    });
    container.set(CORE_AUTH_TOKEN, auth);
  },
};
