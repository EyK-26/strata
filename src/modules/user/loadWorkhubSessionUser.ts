import type { LoadSessionUser, SessionUser } from "@getstrata/bootstrap/web/session";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { revealEmail } from "@getstrata/core/crypto/fieldEncryption";

type SessionQueryRow = {
  id: number;
  name: string;
  email: string;
  role: string;
};

const LOAD_WORKHUB_SESSION_USER_SQL = `SELECT s.user_id AS id, u.name, u.email, u.role
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW()`;

/**
 * CookieSessionStore loader for WorkHub's `users` schema (`role`, no
 * `learn_subscriber` / `is_admin`). Sibling getstrata apps should keep the
 * default SELECT or pass their own loader.
 */
const loadWorkhubSessionUser: LoadSessionUser = async (sql, sessionId) => {
  const rows = (await sql.unsafe(LOAD_WORKHUB_SESSION_USER_SQL, [sessionId])) as SessionQueryRow[];
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: row.name,
    email: revealEmail(row.email),
    is_admin: row.role === "admin",
  };
};

function mapWorkhubSessionUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    role: user.is_admin ? "admin" : "member",
  };
}

export { LOAD_WORKHUB_SESSION_USER_SQL, loadWorkhubSessionUser, mapWorkhubSessionUser };
