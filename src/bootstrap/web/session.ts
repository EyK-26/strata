import { createHmac, randomBytes } from "node:crypto";
import { isAccountActive, matchesAuthVersion } from "@getstrata/core/auth/accountState";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import {
  type AuthGuard,
  AuthManager,
  type AuthOutcome,
  authenticateProof,
  authUserFromOutcome,
} from "@getstrata/core/auth/guard";
import { isSessionInvalidated } from "@getstrata/core/auth/sessionCookie";
import type { ScopedPolicy } from "@getstrata/core/contracts/persistence";
import type { DatabaseSession, TransactionSession } from "@getstrata/core/database/session";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { readRequestCookie } from "@getstrata/core/http/cookies";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";

type Selected = DatabaseSession | TransactionSession;
function sqlPlaceholder(sql: Selected, index: number): string {
  return sql.dialect.placeholder(index);
}
function sqlNow(sql: Selected): string {
  return sql.dialect.nowExpression();
}
function executeSql<Row>(
  sql: Selected,
  text: string,
  params: readonly unknown[] = [],
): Promise<readonly Row[]> {
  return sql.execute<Row>({ text, params });
}
function identifier<T>(
  sql: Selected,
  policy: ScopedPolicy,
  productionRls: boolean,
  id: string | number,
  work: (child: Selected) => T | Promise<T>,
): Promise<T> {
  return productionRls
    ? policy.run(sql, { kind: "identifier", identifier: id }, work)
    : Promise.resolve(work(sql));
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  learn_subscriber?: boolean;
  is_admin?: boolean;
  is_active?: boolean;
  auth_version?: number;
  email_verified_at?: Date | string | null;
}

interface SessionRow {
  id?: string;
  user_id?: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  learn_subscriber?: boolean | null;
  is_admin?: boolean | null;
  is_active?: boolean | number | string | null;
  auth_version?: number;
  email_verified_at?: Date | string | null;
  session_valid_after?: Date | string | null;
  expires_at?: Date;
  created_at?: Date | string | null;
  session_created_at?: Date | string | null;
  last_active_at?: Date | string | null;
}

export type LoadSessionUser = (
  sql: Selected,
  policy: ScopedPolicy,
  rls: boolean,
  sessionId: string,
) => Promise<SessionUser | null>;

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

export type MapSessionUser = (user: SessionUser) => AuthUser;

function defaultMapSessionUser(user: SessionUser): AuthUser {
  return {
    id: user.id,
    ...(user.auth_version !== undefined ? { authVersion: user.auth_version } : {}),
    role: user.is_admin ? "admin" : "member",
    ...(user.email_verified_at !== undefined ? { emailVerifiedAt: user.email_verified_at } : {}),
  };
}

function sessionDisplayName(row: SessionRow, email: string): string {
  if (typeof row.name === "string" && row.name.trim() !== "") {
    return row.name;
  }

  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const composed = `${first} ${last}`.trim();
  return composed || email;
}

function mapSessionUserRow(row: SessionRow): SessionUser {
  const email = typeof row.email === "string" ? row.email : "";
  return {
    id: Number(row.user_id ?? row.id),
    name: sessionDisplayName(row, email),
    email,
    ...(row.auth_version !== undefined ? { auth_version: row.auth_version } : {}),
    learn_subscriber: Boolean(row.learn_subscriber),
    is_admin: Boolean(row.is_admin),
    ...(row.is_active !== undefined
      ? { is_active: row.is_active === true || row.is_active === 1 || row.is_active === "1" }
      : {}),
    ...(row.email_verified_at !== undefined ? { email_verified_at: row.email_verified_at } : {}),
  };
}

async function defaultLoadSessionUser(
  sql: Selected,
  policy: ScopedPolicy,
  rls: boolean,
  sessionId: string,
): Promise<SessionUser | null> {
  const sessionRows = await identifier(sql, policy, rls, sessionId, async (sql) => {
    return (await executeSql(
      sql,
      `SELECT *, created_at AS session_created_at
     FROM sessions
     WHERE id = ${sqlPlaceholder(sql, 1)} AND expires_at > ${sqlNow(sql)}`,
      [sessionId],
    )) as SessionRow[];
  });

  const session = sessionRows[0];
  if (!session) return null;

  const userId = Number(session.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  return await identifier(sql, policy, rls, userId, async (sql) => {
    const rows = (await executeSql(
      sql,
      `SELECT * FROM users WHERE id = ${sqlPlaceholder(sql, 1)}`,
      [userId],
    )) as SessionRow[];

    const row = rows[0];
    if (!row) return null;

    const createdSource = session.session_created_at;
    const createdAt =
      createdSource instanceof Date
        ? createdSource.getTime()
        : createdSource
          ? Date.parse(String(createdSource))
          : Number.NaN;

    if (
      row.auth_version !== undefined
        ? !matchesAuthVersion(session.auth_version, row.auth_version)
        : !Number.isFinite(createdAt) || isSessionInvalidated(createdAt, row.session_valid_after)
    ) {
      return null;
    }

    return mapSessionUserRow({ ...row, user_id: userId, session_created_at: createdSource });
  });
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
    private readonly selected: Selected,
    private readonly policy: ScopedPolicy,
    private readonly secret: string,
    private readonly config: { production: boolean; rls: boolean },
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

  hasCredential(request: Request): boolean {
    // Check presence before decoding/signature validation: malformed supplied cookies
    // are invalid credentials, never an excuse to try a weaker guard.
    return (
      readRequestCookie(request, this.cookieName) !== null ||
      (request.headers
        .get("cookie")
        ?.split(";")
        .some((part) => {
          const separator = part.indexOf("=");
          return (separator === -1 ? part : part.slice(0, separator)).trim() === this.cookieName;
        }) ??
        false)
    );
  }

  sessionIdFromRequest(request: Request): string | null {
    const cookie = readRequestCookie(request, this.cookieName);
    const raw = cookie ?? null;
    if (!raw) return null;

    const [sessionId, signature] = raw.split(".");
    if (!sessionId || !signature || !timingSafeCompareString(signature, this.sign(sessionId))) {
      return null;
    }

    return sessionId;
  }

  private withSecureFlag(header: string): string {
    if (!this.config.production) {
      return header;
    }

    return header.includes("Secure") ? header : `${header}; Secure`;
  }

  async create(user: SessionUser, meta: SessionCreateMeta = {}): Promise<string> {
    if (!isAccountActive(user) || !matchesAuthVersion(user.auth_version, user.auth_version))
      throw new UnauthorizedError();
    const id = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + this.maxAgeSeconds * 1000);
    await identifier(this.selected, this.policy, this.config.rls, user.id, async (sql) => {
      await executeSql(
        sql,
        `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address, last_active_at, created_at${user.auth_version !== undefined ? ", auth_version" : ""})
       VALUES (${sqlPlaceholder(sql, 1)}, ${sqlPlaceholder(sql, 2)}, ${sqlPlaceholder(sql, 3)}, ${sqlPlaceholder(sql, 4)}, ${sqlPlaceholder(sql, 5)}, ${sqlNow(sql)}, ${sqlNow(sql)}${user.auth_version !== undefined ? `, ${sqlPlaceholder(sql, 6)}` : ""})`,
        [
          id,
          user.id,
          sql.dialect.timestampValue(expires),
          meta.userAgent ?? null,
          meta.ipAddress ?? null,
          ...(user.auth_version !== undefined ? [user.auth_version] : []),
        ],
      );
    });
    return id;
  }

  async destroy(sessionId: string): Promise<void> {
    await identifier(this.selected, this.policy, this.config.rls, sessionId, async (sql) => {
      await executeSql(sql, `DELETE FROM sessions WHERE id = ${sqlPlaceholder(sql, 1)}`, [
        sessionId,
      ]);
    });
  }

  async destroyAllSessions(userId: number): Promise<void> {
    await identifier(this.selected, this.policy, this.config.rls, userId, async (sql) => {
      await executeSql(sql, `DELETE FROM sessions WHERE user_id = ${sqlPlaceholder(sql, 1)}`, [
        userId,
      ]);
    });
  }

  async destroyOtherSessions(userId: number, keepSessionId: string): Promise<void> {
    await identifier(this.selected, this.policy, this.config.rls, userId, async (sql) => {
      await executeSql(
        sql,
        `DELETE FROM sessions WHERE user_id = ${sqlPlaceholder(sql, 1)} AND id <> ${sqlPlaceholder(sql, 2)}`,
        [userId, keepSessionId],
      );
    });
  }

  async listForUser(userId: number): Promise<readonly BrowserSessionRecord[]> {
    const dialect = this.selected.dialect;
    return await identifier(this.selected, this.policy, this.config.rls, userId, (sql) =>
      executeSql<BrowserSessionRecord>(
        sql,
        `SELECT id, user_id, user_agent, ip_address, last_active_at, expires_at
       FROM sessions
       WHERE user_id = ${dialect.placeholder(1)} AND expires_at > ${dialect.nowExpression()}
       ORDER BY last_active_at DESC${dialect.nullsLastSuffix()}, expires_at DESC`,
        [userId],
      ),
    );
  }

  async touch(sessionId: string): Promise<void> {
    await identifier(this.selected, this.policy, this.config.rls, sessionId, async (sql) => {
      await executeSql(
        sql,
        `UPDATE sessions SET last_active_at = ${sqlNow(sql)} WHERE id = ${sqlPlaceholder(sql, 1)}`,
        [sessionId],
      );
    });
  }

  async read(request: Request): Promise<SessionUser | null> {
    const sessionId = this.sessionIdFromRequest(request);
    if (!sessionId) return null;

    const user = await this.loadSessionUser(this.selected, this.policy, this.config.rls, sessionId);
    return user && isAccountActive(user) ? user : null;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex").slice(0, 32);
  }
}

export class CookieSessionGuard implements AuthGuard {
  constructor(
    private readonly store: CookieSessionStore,
    private readonly mapUser: MapSessionUser = defaultMapSessionUser,
  ) {}

  authenticate(request: Request): Promise<AuthOutcome> {
    return authenticateProof(
      "session",
      () => this.store.hasCredential(request),
      () => this.resolveUser(request),
    );
  }
  async resolve(request: Request): Promise<AuthUser | null> {
    return authUserFromOutcome(await this.authenticate(request));
  }
  private async resolveUser(request: Request): Promise<AuthUser | null> {
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
    const guard = new CookieSessionGuard(store, mapUser);
    super(guard);
    this.registerGuard("web", guard);
    this.registerGuard("session", guard);
  }

  async signIn(
    user: SessionUser,
    meta: SessionCreateMeta = {},
  ): Promise<{ sessionId: string; setCookie: string }> {
    const current = currentRequestMeta();
    const sessionId = await this.store.create(user, {
      userAgent: meta.userAgent ?? current.userAgent ?? null,
      ipAddress: meta.ipAddress ?? current.ipAddress ?? null,
    });
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
  selected: Selected;
  policy: ScopedPolicy;
  secret: string;
  production: boolean;
  rls: boolean;
  cookieName?: string;
  maxAgeSeconds?: number;
  mapUser?: MapSessionUser;
  loadSessionUser?: LoadSessionUser;
}
export function createCookieSessionAuthManager(
  options: CreateCookieSessionAuthManagerOptions,
): CookieSessionAuthManager {
  if (!options.secret) throw new TypeError("An explicit session secret is required.");
  const store = new CookieSessionStore(
    options.selected,
    options.policy,
    options.secret,
    { production: options.production, rls: options.rls },
    options.cookieName,
    options.maxAgeSeconds,
    options.loadSessionUser,
  );
  return new CookieSessionAuthManager(store, options.mapUser ?? defaultMapSessionUser);
}
export { defaultMapSessionUser };
