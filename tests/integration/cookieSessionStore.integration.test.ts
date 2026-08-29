import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  CookieSessionStore,
  createCookieSessionAuthManager,
} from "@getstrata/bootstrap/web/session";
import { getDatabase } from "../../src/db/connection";
import { migrateDatabase } from "../../src/db/migrations/runner";
import {
  loadWorkhubSessionUser,
  mapWorkhubSessionUser,
} from "../../src/modules/user/loadWorkhubSessionUser";

const TEST_DATABASE_URL = process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running integration tests.");
}

const adminUser = {
  id: 1,
  name: "Admin User",
  email: "admin@workhub.test",
};

const sql = getDatabase();

beforeAll(async () => {
  await migrateDatabase();
});

afterAll(async () => {
  await sql`DELETE FROM sessions WHERE user_id = 1`;
});

describe("CookieSessionStore against WorkHub sessions", () => {
  test("create/read/destroy use the WorkHub role loader, not HMAC cookies", async () => {
    const auth = createCookieSessionAuthManager({
      sql,
      secret: "workhub-cookie-session-test-secret",
      cookieName: "strata_session",
      loadSessionUser: loadWorkhubSessionUser,
      mapUser: mapWorkhubSessionUser,
    });

    const signedIn = await auth.signIn(adminUser);
    expect(signedIn.setCookie.startsWith("strata_session=")).toBe(true);

    const cookie = signedIn.setCookie.split(";")[0] ?? "";
    const request = new Request("http://workhub.test/", { headers: { cookie } });

    expect(await auth.resolve(request)).toEqual({ id: 1, role: "admin" });

    const rows = (await sql`
      SELECT user_id FROM sessions WHERE id = ${signedIn.sessionId}
    `) as Array<{ user_id: number }>;
    expect(rows).toEqual([{ user_id: 1 }]);

    const signedOut = await auth.signOut(request);
    expect(signedOut.setCookie).toContain("Max-Age=0");
    expect(await auth.resolve(request)).toBeNull();

    const remaining = (await sql`
      SELECT id FROM sessions WHERE id = ${signedIn.sessionId}
    `) as Array<{ id: string }>;
    expect(remaining).toEqual([]);
  });

  test("expired session rows do not resolve", async () => {
    const store = new CookieSessionStore(
      sql,
      "workhub-cookie-session-test-secret",
      "strata_session",
      60,
      loadWorkhubSessionUser,
    );
    const sessionId = crypto.randomUUID().replaceAll("-", "");
    await sql`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${sessionId}, 1, NOW() - INTERVAL '1 minute')
    `;

    const cookie = store.cookieHeader(adminUser, sessionId).split(";")[0] ?? "";
    expect(
      await store.read(new Request("http://workhub.test/", { headers: { cookie } })),
    ).toBeNull();
  });

  test("default learn_subscriber SELECT fails on WorkHub users", async () => {
    const store = new CookieSessionStore(sql, "workhub-cookie-session-test-secret");
    const sessionId = await store.create(adminUser);
    const cookie = store.cookieHeader(adminUser, sessionId).split(";")[0] ?? "";

    await expect(
      store.read(new Request("http://workhub.test/", { headers: { cookie } })),
    ).rejects.toThrow(/learn_subscriber|is_admin|column/i);

    await store.destroy(sessionId);
  });
});
