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

export type LoadSessionUser = (sql: SqlClient, sessionId: string) => Promise<SessionUser | null>;

export interface SessionCreateMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface BrowserSessionRecord {
  id: string;
  user_id: number;
  user_agent: string | null;
  ip_address: string | null;
  last_active_at: Date | string | null;
  expires_at: Date | string;
}

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

async function defaultLoadSessionUser(
  sql: SqlClient,
  sessionId: string,
): Promise<SessionUser | null> {
  const rows = (await sql.unsafe(
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

function redirectWithCookie(location: string, setCookie: string, status: number): Response {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      "Set-Cookie": setCookie,
    },
  });
}

export class CookieSessionStore {
  constructor(
    private readonly sqlSource: SqlSource,
    private readonly secret: string,
    private readonly cookieName = "strata_session",
    private readonly maxAgeSeconds = 60 * 60 * 24 * 14,
    private readonly loadSessionUser: LoadSessionUser = defaultLoadSessionUser,
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

  sessionIdFromRequest(request: Request): string | null {
    const cookie = readRequestCookie(request, this.cookieName);
    const raw = cookie ?? null;
    if (!raw) return null;

    const [sessionId, signature] = raw.split(".");
    if (!sessionId || !signature || signature !== this.sign(sessionId)) {
      return null;
    }

    return sessionId;
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

  async create(user: SessionUser, meta: SessionCreateMeta = {}): Promise<string> {
    const id = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + this.maxAgeSeconds * 1000);
    await this.sql().unsafe(
      `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address, last_active_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [id, user.id, expires, meta.userAgent ?? null, meta.ipAddress ?? null],
    );
    return id;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.sql().unsafe(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }

  async destroyOtherSessions(userId: number, keepSessionId: string): Promise<void> {
    await this.sql().unsafe(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [
      userId,
      keepSessionId,
    ]);
  }

  async listForUser(userId: number): Promise<BrowserSessionRecord[]> {
    return this.sql().unsafe<BrowserSessionRecord>(
      `SELECT id, user_id, user_agent, ip_address, last_active_at, expires_at
       FROM sessions
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY last_active_at DESC NULLS LAST, expires_at DESC`,
      [userId],
    );
  }

  async touch(sessionId: string): Promise<void> {
    await this.sql().unsafe(`UPDATE sessions SET last_active_at = NOW() WHERE id = $1`, [
      sessionId,
    ]);
  }

  async read(request: Request): Promise<SessionUser | null> {
    const sessionId = this.sessionIdFromRequest(request);
    if (!sessionId) return null;

    return this.loadSessionUser(this.sql(), sessionId);
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

export class CookieSessionAuthManager extends AuthManager {
  constructor(
    readonly store: CookieSessionStore,
    mapUser: MapSessionUser = defaultMapSessionUser,
  ) {
    super(new CookieSessionGuard(store, mapUser));
  }

  async signIn(
    user: SessionUser,
    meta: SessionCreateMeta = {},
  ): Promise<{ sessionId: string; setCookie: string }> {
    const sessionId = await this.store.create(user, meta);
    return { sessionId, setCookie: this.store.cookieHeader(user, sessionId) };
  }

  async signOut(request: Request): Promise<{ setCookie: string }> {
    const sessionId = this.store.sessionIdFromRequest(request);
    if (sessionId) {
      await this.store.destroy(sessionId);
    }

    return { setCookie: this.store.clearCookieHeader() };
  }

  async signInRedirect(
    user: SessionUser,
    location: string,
    status = 302,
    meta: SessionCreateMeta = {},
  ): Promise<Response> {
    const { setCookie } = await this.signIn(user, meta);
    return redirectWithCookie(location, setCookie, status);
  }

  async signOutRedirect(request: Request, location: string, status = 302): Promise<Response> {
    const { setCookie } = await this.signOut(request);
    return redirectWithCookie(location, setCookie, status);
  }
}

export interface CreateCookieSessionAuthManagerOptions {
  store?: CookieSessionStore;
  sql?: SqlSource;
  secret?: string;
  cookieName?: string;
  maxAgeSeconds?: number;
  mapUser?: MapSessionUser;
  loadSessionUser?: LoadSessionUser;
}

function createCookieSessionAuthManager(
  options: CreateCookieSessionAuthManagerOptions = {},
): CookieSessionAuthManager {
  const store =
    options.store ??
    new CookieSessionStore(
      options.sql ?? defaultSessionSql,
      options.secret ?? process.env.SESSION_SECRET?.trim() ?? "",
      options.cookieName,
      options.maxAgeSeconds,
      options.loadSessionUser,
    );

  return new CookieSessionAuthManager(store, options.mapUser ?? defaultMapSessionUser);
}

export { createCookieSessionAuthManager, defaultMapSessionUser, defaultSessionSql };
