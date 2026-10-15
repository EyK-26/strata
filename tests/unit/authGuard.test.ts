import { describe, expect, test } from "bun:test";
import { ApiTokenGuard, AuthManager, CompositeGuard, GuestGuard } from "@getstrata/core/auth/guard";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("AuthManager", () => {
  test("GuestGuard always resolves null without dev headers", async () => {
    const auth = new AuthManager(new GuestGuard());

    expect(await auth.check()).toBe(false);
    expect(await auth.user()).toBeNull();
  });

  test("ApiTokenGuard authenticates matching bearer tokens", async () => {
    const auth = new AuthManager(
      new ApiTokenGuard({
        token: "secret-token",
        user: { id: 1, role: "admin" },
      }),
    );
    const request = new Request("http://example.test", {
      headers: { authorization: "Bearer secret-token" },
    });

    expect(await auth.resolve(request)).toEqual({ id: 1, role: "admin" });
    expect(await auth.check(request)).toBe(true);
  });

  test("ApiTokenGuard rejects missing or invalid tokens", async () => {
    const auth = new AuthManager(new ApiTokenGuard({ token: "secret-token", user: { id: 1 } }));

    expect(await auth.check(new Request("http://example.test"))).toBe(false);
    expect(
      await auth.check(
        new Request("http://example.test", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
  });

  test("requireUser throws UnauthorizedError for guests", async () => {
    const auth = new AuthManager(new GuestGuard());

    await expect(auth.requireUser()).rejects.toThrow(UnauthorizedError);
  });

  test("GuestGuard ignores identity headers unless AUTH_DEV_HEADERS is exactly true", () => {
    const previous = process.env.AUTH_DEV_HEADERS;
    delete process.env.AUTH_DEV_HEADERS;
    try {
      expect(
        new GuestGuard().resolve(
          new Request("http://example.test", {
            headers: { "x-authenticated-user-id": "7" },
          }),
        ),
      ).toBeNull();
      process.env.AUTH_DEV_HEADERS = "TRUE";
      expect(
        new GuestGuard().resolve(
          new Request("http://example.test", {
            headers: { "x-authenticated-user-id": "7" },
          }),
        ),
      ).toBeNull();
    } finally {
      restoreEnvVar("AUTH_DEV_HEADERS", previous);
    }
  });

  test("GuestGuard treats missing verification header as unverified", () => {
    const previous = process.env.AUTH_DEV_HEADERS;
    const previousApp = process.env.APP_ENV;
    const previousNode = process.env.NODE_ENV;
    process.env.AUTH_DEV_HEADERS = "true";
    process.env.APP_ENV = "local";
    delete process.env.NODE_ENV;
    try {
      const user = new GuestGuard().resolve(
        new Request("http://example.test", {
          headers: { "x-authenticated-user-id": "7" },
        }),
      );
      expect(user?.emailVerifiedAt).toBeNull();
      const verified = new GuestGuard().resolve(
        new Request("http://example.test", {
          headers: {
            "x-authenticated-user-id": "7",
            "x-authenticated-email-verified": "true",
          },
        }),
      );
      expect(verified?.emailVerifiedAt).toEqual(new Date(0));
    } finally {
      restoreEnvVar("AUTH_DEV_HEADERS", previous);
      restoreEnvVar("APP_ENV", previousApp);
      restoreEnvVar("NODE_ENV", previousNode);
    }
  });

  test("GuestGuard is always null in production even when AUTH_DEV_HEADERS is true", () => {
    const previous = process.env.AUTH_DEV_HEADERS;
    const previousApp = process.env.APP_ENV;
    const previousNode = process.env.NODE_ENV;
    process.env.AUTH_DEV_HEADERS = "true";
    delete process.env.NODE_ENV;
    const request = new Request("http://example.test", {
      headers: { "x-authenticated-user-id": "7" },
    });
    try {
      process.env.APP_ENV = "production";
      expect(new GuestGuard().resolve(request)).toBeNull();
      process.env.APP_ENV = "staging";
      expect(new GuestGuard().resolve(request)).toBeNull();
    } finally {
      restoreEnvVar("AUTH_DEV_HEADERS", previous);
      restoreEnvVar("APP_ENV", previousApp);
      restoreEnvVar("NODE_ENV", previousNode);
    }
  });

  test("failed bearer does not fall back to a session or guest guard", async () => {
    const sessionGuard = {
      resolve() {
        return { id: 99, role: "session" };
      },
    };
    const auth = new AuthManager(new CompositeGuard([sessionGuard]));
    auth.registerGuard("web", sessionGuard);
    auth.registerGuard("session", sessionGuard);

    expect(
      await auth.resolveWithSource(
        new Request("http://example.test", { headers: { authorization: "Bearer garbage" } }),
      ),
    ).toEqual({ user: null, credentialSource: null });
  });
});

// Basic one-time proofs must survive repeated user/check/requireUser calls on one Request.
describe("Basic request resolution", () => {
  const request = () =>
    new Request("http://fixture.test", {
      headers: { authorization: "Basic fixture", "x-mfa-code": "one-use-proof" },
    });
  test("shares in-flight resolution within one request and isolates later requests", async () => {
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const auth = new AuthManager({ resolve: () => null });
    auth.registerGuard("basic", {
      resolve: async () => {
        calls++;
        await gate;
        return { id: calls };
      },
    });
    const req = request();
    const results = Promise.all([auth.user(req), auth.check(req), auth.requireUser(req)]);
    expect(calls).toBe(1);
    release();
    expect(await results).toEqual([{ id: 1 }, true, { id: 1 }]);
    expect(await auth.user(request())).toEqual({ id: 2 });
  });
  test("invalidates Basic results after credential, scheme or guard changes", async () => {
    let calls = 0;
    const auth = new AuthManager({ resolve: () => null });
    auth.registerGuard("basic", { resolve: () => ({ id: ++calls }) });
    const req = request();
    expect((await auth.user(req))?.id).toBe(1);
    req.headers.set("x-mfa-code", "another-proof");
    expect((await auth.user(req))?.id).toBe(2);
    req.headers.set("authorization", "Basic another");
    expect((await auth.user(req))?.id).toBe(3);
    req.headers.set("authorization", "Bearer invalid");
    expect(await auth.user(req)).toBeNull();
    req.headers.set("authorization", "Basic another");
    expect((await auth.user(req))?.id).toBe(4);
    auth.registerGuard("basic", { resolve: () => ({ id: 99 }) });
    expect((await auth.user(req))?.id).toBe(99);
  });
  test("retains denial only within that request and does not retain infrastructure errors", async () => {
    let calls = 0;
    const auth = new AuthManager({ resolve: () => null });
    auth.registerGuard("basic", {
      resolve: () => {
        calls++;
        return null;
      },
    });
    const req = request();
    expect(await auth.user(req)).toBeNull();
    expect(await auth.user(req)).toBeNull();
    expect(calls).toBe(1);
    expect(await auth.user(request())).toBeNull();
    expect(calls).toBe(2);
    let failed = true;
    auth.registerGuard("basic", {
      resolve: () => {
        if (failed) {
          failed = false;
          throw new Error("SQL unavailable");
        }
        return { id: 7 };
      },
    });
    await expect(auth.user(req)).rejects.toThrow("SQL unavailable");
    expect(await auth.user(req)).toEqual({ id: 7 });
  });
  test("an older failed resolution cannot discard a newer credential result", async () => {
    let calls = 0;
    let rejectOld = (_error: Error) => {};
    const old = new Promise<null>((_resolve, reject) => {
      rejectOld = reject;
    });
    const auth = new AuthManager({ resolve: () => null });
    auth.registerGuard("basic", { resolve: () => (++calls === 1 ? old : { id: 8 }) });
    const req = request();
    const failure = auth.user(req).catch((error: unknown) => error);
    req.headers.set("x-mfa-code", "new-proof");
    expect(await auth.user(req)).toEqual({ id: 8 });
    rejectOld(new Error("old failure"));
    expect(await failure).toMatchObject({ message: "old failure" });
    expect(await auth.user(req)).toEqual({ id: 8 });
    expect(calls).toBe(2);
  });
});
