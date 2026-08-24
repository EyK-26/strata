import { createHash, randomBytes } from "node:crypto";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { type AuthGuard, AuthManager } from "@getstrata/core/auth/guard";
import { getBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { getDefaultDatabasePool } from "@getstrata/core/database/defaultConnection";
import { readRequestCookie } from "@getstrata/core/http/cookies";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  learn_subscriber?: boolean;
  is_admin?: boolean;
}

interface SessionRow {
  id: string;
  user_id: number;
  name: string;
  email: string;
  learn_subscriber: boolean;
  is_admin: boolean;
  expires_at: Date;
}

type SqlClient = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
};

type SqlSource = SqlClient | (() => SqlClient);

function isSqlClient(value: SqlSource): value is SqlClient {
  return typeof (value as SqlClient).unsafe === "function";
}

function resolveSql(source: SqlSource): SqlClient {
  if (isSqlClient(source)) {
    return source;
  }

  return source();
}

function defaultSessionSql(): SqlClient {
  const bound = getBoundDatabaseConnection();

  if (bound) {
    return bound;
  }

  return getDefaultDatabasePool();
}

export type MapSessionUser = (user: SessionUser) => AuthUser;

function defaultMapSessionUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    role: user.is_admin ? "admin" : "member",
  };
}

export class CookieSessionStore {
  constructor(
    private readonly sqlSource: SqlSource,
    private readonly secret: string,
    private readonly cookieName = "strata_session",
    private readonly maxAgeSeconds = 60 * 60 * 24 * 14,
  ) {}

  cookieHeader(_user: SessionUser, sessionId: string): string {
    const payload = `${sessionId}.${this.sign(sessionId)}`;
    return this.withSecureFlag(
      `${this.cookieName}=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${this.maxAgeSeconds}`,
    );
  }

  clearCookieHeader(): string {
    return this.withSecureFlag(`${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  private withSecureFlag(header: string): string {
    if (process.env.NODE_ENV !== "production") {
      return header;
    }

    return header.includes("Secure") ? header : `${header}; Secure`;
  }

  private sql(): SqlClient {
    return resolveSql(this.sqlSource);
  }

  async create(user: SessionUser): Promise<string> {
    const id = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + this.maxAgeSeconds * 1000);
    await this.sql().unsafe(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`, [
      id,
      user.id,
      expires,
    ]);
    return id;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.sql().unsafe(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }

  async read(request: Request): Promise<SessionUser | null> {
    const cookie = readRequestCookie(request, this.cookieName);
    const raw = cookie ?? null;
    if (!raw) return null;

    const [sessionId, signature] = raw.split(".");
    if (!sessionId || !signature || signature !== this.sign(sessionId)) {
      return null;
    }

    const rows = (await this.sql().unsafe(
      `SELECT s.id, s.user_id, s.expires_at, u.name, u.email, u.learn_subscriber,
              COALESCE(u.is_admin, false) AS is_admin
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sessionId],
    )) as SessionRow[];

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.user_id,
      name: row.name,
      email: row.email,
      learn_subscriber: row.learn_subscriber,
      is_admin: row.is_admin,
    };
  }

  private sign(value: string): string {
    return createHash("sha256").update(`${value}.${this.secret}`).digest("hex").slice(0, 32);
  }
}

export class CookieSessionGuard implements AuthGuard {
  constructor(
    private readonly store: CookieSessionStore,
    private readonly mapUser: MapSessionUser = defaultMapSessionUser,
  ) {}

  async resolve(request: Request): Promise<AuthUser | null> {
    const user = await this.store.read(request);

    if (!user) {
      return null;
    }

    return this.mapUser(user);
  }
}

export interface CreateCookieSessionAuthManagerOptions {
  store?: CookieSessionStore;
  sql?: SqlSource;
  secret?: string;
  cookieName?: string;
  maxAgeSeconds?: number;
  mapUser?: MapSessionUser;
}

function createCookieSessionAuthManager(
  options: CreateCookieSessionAuthManagerOptions = {},
): AuthManager {
  const store =
    options.store ??
    new CookieSessionStore(
      options.sql ?? defaultSessionSql,
      options.secret ?? process.env.SESSION_SECRET?.trim() ?? "",
      options.cookieName,
      options.maxAgeSeconds,
    );

  return new AuthManager(new CookieSessionGuard(store, options.mapUser ?? defaultMapSessionUser));
}

export { createCookieSessionAuthManager, defaultMapSessionUser, defaultSessionSql };
