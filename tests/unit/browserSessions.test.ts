import { afterEach, describe, expect, test } from "bun:test";
import { getDatabase } from "../../src/db/connection";
import {
  clientIpAddress,
  clientUserAgent,
  forgetHmacBrowserSession,
  forgetOtherBrowserSessions,
  hmacBrowserSessionId,
  issueHmacBrowserSession,
  listBrowserSessionsForUser,
  recordHmacBrowserSession,
} from "../../src/modules/user/browserSessions";

describe("browserSessions", () => {
  const ids: string[] = [];

  afterEach(async () => {
    if (ids.length === 0) {
      return;
    }

    const db = getDatabase();

    for (const id of ids) {
      await db`DELETE FROM sessions WHERE id = ${id}`;
    }

    ids.length = 0;
  });

  test("hashes a stable HMAC session id", () => {
    expect(hmacBrowserSessionId(4, 100)).toBe(hmacBrowserSessionId(4, 100));
    expect(hmacBrowserSessionId(4, 100)).not.toBe(hmacBrowserSessionId(4, 101));
  });

  test("reads client IP and user agent", () => {
    expect(
      clientIpAddress(
        new Request("http://localhost/", {
          headers: { "x-forwarded-for": " 10.0.0.2, 10.0.0.3 ", "x-real-ip": "10.1.1.1" },
        }),
      ),
    ).toBe("10.0.0.2");
    expect(
      clientIpAddress(new Request("http://localhost/", { headers: { "x-real-ip": " 10.9.9.9 " } })),
    ).toBe("10.9.9.9");
    expect(clientIpAddress(new Request("http://localhost/"))).toBeNull();
    expect(
      clientIpAddress(
        new Request("http://localhost/", {
          headers: { "x-forwarded-for": "  ", "x-real-ip": "10.2.2.2" },
        }),
      ),
    ).toBe("10.2.2.2");
    expect(
      clientIpAddress(new Request("http://localhost/", { headers: { "x-forwarded-for": " , " } })),
    ).toBeNull();
    expect(
      clientUserAgent(new Request("http://localhost/", { headers: { "user-agent": " Bun/1.4 " } })),
    ).toBe("Bun/1.4");
    expect(clientUserAgent(new Request("http://localhost/"))).toBeNull();
  });

  test("records, lists, and forgets HMAC browser sessions", async () => {
    const issuedAt = Date.now();
    const id = await recordHmacBrowserSession({
      userId: 2,
      issuedAt,
      ttlSeconds: 600,
      userAgent: "WorkHubTest/1.0",
      ipAddress: "203.0.113.10",
    });
    ids.push(id);
    await recordHmacBrowserSession({
      userId: 2,
      issuedAt,
      ttlSeconds: 900,
      userAgent: "WorkHubTest/2.0",
      ipAddress: "203.0.113.11",
    });

    const request = new Request("http://localhost/account", {
      headers: {
        cookie: `workhub_session=placeholder`,
      },
    });
    const listed = await listBrowserSessionsForUser(2);
    const match = listed.find((row) => row.id === id);

    expect(match?.user_agent).toBe("WorkHubTest/2.0");
    expect(match?.ip_address).toBe("203.0.113.11");
    expect(match?.current).toBe(false);

    await forgetHmacBrowserSession(2, issuedAt);
    ids.length = 0;
    expect((await listBrowserSessionsForUser(2, request)).some((row) => row.id === id)).toBe(false);
  });

  test("issues a cookie session and prunes expired rows", async () => {
    const expiredId = await recordHmacBrowserSession({
      userId: 2,
      issuedAt: Date.now() - 5_000,
      ttlSeconds: 1,
    });
    const plain = await issueHmacBrowserSession(new Request("http://localhost/login"), 2);
    ids.push(plain.id);
    const issued = await issueHmacBrowserSession(
      new Request("http://localhost/login", {
        headers: {
          "user-agent": "IssuedAgent/1",
          "x-forwarded-for": "198.51.100.4",
        },
      }),
      2,
      { remember: true },
    );
    ids.push(issued.id);

    const cookiePair = issued.header.split(";")[0] ?? "";
    const listed = await listBrowserSessionsForUser(
      2,
      new Request("http://localhost/account", { headers: { cookie: cookiePair } }),
    );
    expect(listed.some((row) => row.id === expiredId)).toBe(false);
    const current = listed.find((row) => row.id === issued.id);
    expect(current?.current).toBe(true);
    expect(current?.user_agent).toBe("IssuedAgent/1");
    expect(current?.ip_address).toBe("198.51.100.4");

    const otherId = await recordHmacBrowserSession({
      userId: 2,
      issuedAt: Date.now() + 1,
      ttlSeconds: 600,
    });
    ids.push(otherId);
    await forgetOtherBrowserSessions(2, issued.id);
    ids.splice(ids.indexOf(otherId), 1);
    expect((await listBrowserSessionsForUser(2)).map((row) => row.id)).toContain(issued.id);
    expect((await listBrowserSessionsForUser(2)).map((row) => row.id)).not.toContain(otherId);
  });
});
