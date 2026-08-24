import { afterEach, describe, expect, test } from "bun:test";
import {
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
  const sessions = new Map<string, { userId: number; expiresAt: Date }>();

  return {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      if (query.includes("INSERT INTO sessions")) {
        const [id, userId, expires] = params as [string, number, Date];
        sessions.set(id, { userId, expiresAt: expires });
        return [] as T[];
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
});
