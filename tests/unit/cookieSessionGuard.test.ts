import { afterEach, describe, expect, test } from "bun:test";
import {
  CookieSessionAuthManager,
  CookieSessionGuard,
  CookieSessionStore,
  createCookieSessionAuthManager,
  type SessionUser,
} from "@getstrata/bootstrap/web/session";
import { createSessionCookie } from "@getstrata/core/auth/sessionCookie";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";

function createFakeSql(user: SessionUser) {
  const sessions = new Map<
    string,
    {
      userId: number;
      expiresAt: Date;
      userAgent: string | null;
      ipAddress: string | null;
      lastActiveAt: Date | null;
    }
  >();

  return {
    sessions,
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      if (query.includes("INSERT INTO sessions")) {
        const [id, userId, expires, userAgent, ipAddress] = params as [
          string,
          number,
          Date,
          string | null | undefined,
          string | null | undefined,
        ];
        sessions.set(id, {
          userId,
          expiresAt: expires,
          userAgent: userAgent ?? null,
          ipAddress: ipAddress ?? null,
          lastActiveAt: new Date(),
        });
        return [] as T[];
      }

      if (query.includes("DELETE FROM sessions") && query.includes("user_id")) {
        const userId = Number(params[0]);
        const keepId = String(params[1]);
        for (const [id, session] of [...sessions.entries()]) {
          if (session.userId === userId && id !== keepId) {
            sessions.delete(id);
          }
        }
        return [] as T[];
      }

      if (query.includes("DELETE FROM sessions")) {
        sessions.delete(String(params[0]));
        return [] as T[];
      }

      if (query.includes("UPDATE sessions SET last_active_at")) {
        const session = sessions.get(String(params[0]));
        if (session) {
          session.lastActiveAt = new Date();
        }
        return [] as T[];
      }

      if (query.includes("FROM sessions") && query.includes("user_id = $1")) {
        const userId = Number(params[0]);
        return [...sessions.entries()]
          .filter(
            ([, session]) => session.userId === userId && session.expiresAt.getTime() > Date.now(),
          )
          .map(([id, session]) => ({
            id,
            user_id: session.userId,
            user_agent: session.userAgent,
            ip_address: session.ipAddress,
            last_active_at: session.lastActiveAt,
            expires_at: session.expiresAt,
          })) as T[];
      }

      if (query.includes("FROM sessions")) {
        const sessionId = String(params[0]);
        const session = sessions.get(sessionId);

        if (!session || session.expiresAt.getTime() <= Date.now()) {
          return [] as T[];
        }

        return [
          {
            id: sessionId,
            user_id: user.id,
            name: user.name,
            first_name: (user as SessionUser & { first_name?: string }).first_name,
            last_name: (user as SessionUser & { last_name?: string }).last_name,
            email: user.email,
            learn_subscriber: user.learn_subscriber ?? false,
            is_admin: user.is_admin ?? false,
            expires_at: session.expiresAt,
          },
        ] as T[];
      }

      return [] as T[];
    },
  };
}

describe("CookieSessionGuard", () => {
  afterEach(() => {
    resetBoundDatabaseConnection();
  });

  test("AuthManager.resolve maps a store cookie, not HMAC workhub_session", async () => {
    const user: SessionUser = {
      id: 9,
      name: "Ada",
      email: "ada@example.test",
      is_admin: true,
    };
    const sql = createFakeSql(user);
    const store = new CookieSessionStore(sql, "session-secret", "strata_session");
    const auth = createCookieSessionAuthManager({
      store,
      mapUser: (sessionUser) => ({
        id: sessionUser.id,
        role: sessionUser.is_admin
          ? "admin"
          : sessionUser.learn_subscriber
            ? "subscriber"
            : "member",
      }),
    });

    const sessionId = await store.create(user);
    const cookie = store.cookieHeader(user, sessionId).split(";")[0] ?? "";

    expect(
      await auth.resolve(new Request("http://example.test/", { headers: { cookie } })),
    ).toEqual({ id: 9, role: "admin" });
    expect(cookie.startsWith("strata_session=")).toBe(true);

    const hmacCookie = createSessionCookie(9).split(";")[0] ?? "";
    expect(hmacCookie.startsWith("workhub_session=")).toBe(true);
    expect(
      await auth.resolve(new Request("http://example.test/", { headers: { cookie: hmacCookie } })),
    ).toBeNull();
  });

  test("rebinds the SQL client through bindDatabaseConnection", async () => {
    const user: SessionUser = {
      id: 4,
      name: "Member",
      email: "member@example.test",
      is_admin: true,
    };
    const sql = createFakeSql(user);
    bindDatabaseConnection(sql);

    const store = new CookieSessionStore(() => sql, "session-secret", "strata_session");
    const auth = createCookieSessionAuthManager({
      secret: "session-secret",
      cookieName: "strata_session",
    });

    const sessionId = await store.create(user);
    const cookie = store.cookieHeader(user, sessionId).split(";")[0] ?? "";

    expect(
      await auth.resolve(new Request("http://example.test/", { headers: { cookie } })),
    ).toEqual({ id: 4, role: "admin" });
    expect(
      await new CookieSessionGuard(store).resolve(new Request("http://example.test/")),
    ).toBeNull();
  });

  test("loadSessionUser replaces the default users-table query", async () => {
    const user: SessionUser = {
      id: 12,
      name: "Pat",
      email: "pat@example.test",
    };
    const sessions = new Map<string, SessionUser>();
    const sql = {
      async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
        if (query.includes("INSERT INTO sessions")) {
          sessions.set(String(params[0]), user);
          return [] as T[];
        }

        return [] as T[];
      },
    };

    const auth = createCookieSessionAuthManager({
      sql,
      secret: "session-secret",
      cookieName: "strata_session",
      loadSessionUser: async (_client, sessionId) => sessions.get(sessionId) ?? null,
      mapUser: (sessionUser) => ({ id: sessionUser.id, role: "member" }),
    });

    const signedIn = await auth.signIn(user);
    const request = new Request("http://example.test/", {
      headers: { cookie: signedIn.setCookie.split(";")[0] ?? "" },
    });

    expect(await auth.resolve(request)).toEqual({ id: 12, role: "member" });
    expect(sessions.size).toBe(1);
  });

  test("signIn and signOut set cookies and destroy the session row", async () => {
    const user: SessionUser = {
      id: 8,
      name: "Sam",
      email: "sam@example.test",
      is_admin: false,
    };
    const sql = createFakeSql(user);
    const auth = createCookieSessionAuthManager({
      sql,
      secret: "session-secret",
      cookieName: "strata_session",
    });

    expect(auth).toBeInstanceOf(CookieSessionAuthManager);

    const signedIn = await auth.signIn(user);
    expect(signedIn.sessionId.length).toBeGreaterThan(8);
    expect(signedIn.setCookie.startsWith("strata_session=")).toBe(true);
    expect(sql.sessions.has(signedIn.sessionId)).toBe(true);

    const cookie = signedIn.setCookie.split(";")[0] ?? "";
    const request = new Request("http://example.test/", { headers: { cookie } });
    expect(await auth.resolve(request)).toEqual({ id: 8, role: "member" });

    const signedOut = await auth.signOut(request);
    expect(signedOut.setCookie).toContain("Max-Age=0");
    expect(sql.sessions.has(signedIn.sessionId)).toBe(false);
    expect(await auth.resolve(request)).toBeNull();
  });

  test("signInRedirect and signOutRedirect attach Set-Cookie", async () => {
    const user: SessionUser = {
      id: 3,
      name: "Lee",
      email: "lee@example.test",
      is_admin: true,
    };
    const sql = createFakeSql(user);
    const auth = createCookieSessionAuthManager({
      sql,
      secret: "session-secret",
      cookieName: "strata_session",
      mapUser: (sessionUser) => ({
        id: sessionUser.id,
        role: sessionUser.is_admin ? "admin" : "member",
      }),
    });

    const login = await auth.signInRedirect(user, "/dashboard", 303);
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/dashboard");
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith("strata_session=")).toBe(true);

    const cookie = setCookie.split(";")[0] ?? "";
    const request = new Request("http://example.test/", { headers: { cookie } });
    expect(await auth.resolve(request)).toEqual({ id: 3, role: "admin" });

    const logout = await auth.signOutRedirect(request, "/login");
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/login");
    expect(logout.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  test("signOut without a session cookie still clears the cookie header", async () => {
    const sql = createFakeSql({
      id: 1,
      name: "Guest",
      email: "guest@example.test",
    });
    const auth = createCookieSessionAuthManager({
      sql,
      secret: "session-secret",
    });

    const result = await auth.signOut(new Request("http://example.test/"));
    expect(result.setCookie).toContain("Max-Age=0");
    expect(sql.sessions.size).toBe(0);
  });

  test("create stores browser metadata and listForUser returns live sessions", async () => {
    const user: SessionUser = {
      id: 11,
      name: "Meta",
      email: "meta@example.test",
    };
    const sql = createFakeSql(user);
    const store = new CookieSessionStore(sql, "session-secret", "strata_session");
    const sessionId = await store.create(user, {
      userAgent: "HiroAppTest/1.0",
      ipAddress: "203.0.113.10",
    });
    const listed = await store.listForUser(11);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(sessionId);
    expect(listed[0]?.user_agent).toBe("HiroAppTest/1.0");
    expect(listed[0]?.ip_address).toBe("203.0.113.10");
    await store.touch(sessionId);
    expect(sql.sessions.get(sessionId)?.lastActiveAt).toBeInstanceOf(Date);
  });

  test("destroyOtherSessions keeps the current cookie row", async () => {
    const user: SessionUser = {
      id: 14,
      name: "Keep",
      email: "keep@example.test",
    };
    const sql = createFakeSql(user);
    const store = new CookieSessionStore(sql, "session-secret", "strata_session");
    const keep = await store.create(user, { userAgent: "ThisDevice/1.0" });
    const other = await store.create(user, { userAgent: "OtherDevice/1.0" });
    await store.destroyOtherSessions(14, keep);
    expect(sql.sessions.has(keep)).toBe(true);
    expect(sql.sessions.has(other)).toBe(false);
    expect(await store.listForUser(14)).toHaveLength(1);
  });

  test("composes a display name from first_name and last_name", async () => {
    const user = {
      id: 21,
      name: "",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.test",
      is_admin: true,
    } as SessionUser & { first_name: string; last_name: string };
    const sql = createFakeSql(user);
    const store = new CookieSessionStore(sql, "session-secret", "strata_session");
    let loadedName = "";
    const auth = createCookieSessionAuthManager({
      store,
      mapUser: (sessionUser) => {
        loadedName = sessionUser.name;
        return {
          id: sessionUser.id,
          role: sessionUser.is_admin ? "admin" : "member",
        };
      },
    });

    const sessionId = await store.create(user);
    const cookie = store.cookieHeader(user, sessionId).split(";")[0] ?? "";

    expect(
      await auth.resolve(new Request("http://example.test/", { headers: { cookie } })),
    ).toEqual({ id: 21, role: "admin" });
    expect(loadedName).toBe("Ada Lovelace");
  });
});
