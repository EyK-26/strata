import { describe, expect, test } from "bun:test";
import {
  createMetadataAuthManager,
  type MetadataAuthOptions,
} from "@getstrata/bootstrap/providers/auth";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";

const accounts = { findByIdOrThrow: async (id: number) => ({ id, role: "member" }) };
const email = { findByEmail: async () => null };
const recover = async () => false;
const secret = "capability-fixture-signing-key-at-least-32-characters";
function options(mechanisms: MetadataAuthOptions["mechanisms"]): MetadataAuthOptions {
  return {
    mechanisms,
    production: true,
    allowDevHeaders: false,
    jwtSecret: secret,
    readSession: () => null,
    abilities: { admin: ["*"], member: [] },
    roleAbilities: () => [],
  };
}
const session = { read: () => null, abilities: () => [], validity: null };

describe("selected authentication capabilities", () => {
  test("requires each selected mechanism's adapter at assembly", () => {
    for (const mechanism of ["api", "jwt", "basic", "session"] as const) {
      expect(() => createMetadataAuthManager({}, options([mechanism]), recover)).toThrow(TypeError);
    }
    expect(() => createMetadataAuthManager(accounts, options(["basic"]), recover)).toThrow(
      TypeError,
    );
    expect(() =>
      createMetadataAuthManager(accounts, { ...options(["jwt"]), jwtSecret: "" }, recover),
    ).toThrow(TypeError);
  });

  test("validates selected optional ports and recovery persistence instead of silently disabling them", () => {
    expect(() =>
      createMetadataAuthManager({ ...accounts, ...email }, options(["basic"]), undefined as never),
    ).toThrow(TypeError);
    expect(() =>
      createMetadataAuthManager(
        { ...accounts, ...email, verifyCredentials: "invalid" as never },
        options(["basic"]),
        recover,
      ),
    ).toThrow(TypeError);
    expect(() =>
      createMetadataAuthManager(
        { ...accounts, hasActiveBrowserSession: "invalid" as never },
        options(["session"]),
        recover,
      ),
    ).toThrow(TypeError);
    expect(() =>
      createMetadataAuthManager(
        {},
        { ...options(["session"]), sessionGuard: {} as never },
        recover,
      ),
    ).toThrow(TypeError);
    expect(() =>
      createMetadataAuthManager(
        accounts,
        { ...options(["session"]), readSession: undefined as never },
        recover,
      ),
    ).toThrow(TypeError);
  });

  test("does not require capabilities for disabled mechanisms or a custom session guard", async () => {
    const empty = createMetadataAuthManager({}, options([]), recover);
    expect(await empty.resolve(new Request("http://example.test/"))).toBeNull();
    const custom = createMetadataAuthManager(
      {},
      { ...options(["session"]), sessionGuard: { resolve: () => ({ id: "custom-session" }) } },
      recover,
    );
    expect(await custom.resolve(new Request("http://example.test/"))).toEqual({
      id: "custom-session",
    });
    const jwt = createMetadataAuthManager(accounts, options(["jwt"]), recover);
    expect(jwt.guardNames()).toContain("jwt");
    const basic = createMetadataAuthManager(
      { ...accounts, verifyCredentials: async () => null },
      options(["basic"]),
      recover,
    );
    expect(basic.guardNames()).toContain("basic");
  });

  test("a minimal bearer resolver retains its private receiver and needs no account lookup", async () => {
    class Tokens {
      #token = "opaque-fixture";
      async resolveUserFromToken(token: string) {
        return token === this.#token ? { id: "token-actor", isActive: true } : null;
      }
    }
    const auth = createMetadataAuthManager(new Tokens(), options(["api"]), recover);
    const request = new Request("http://example.test/", {
      headers: { authorization: "Bearer opaque-fixture" },
    });
    expect(await auth.resolveWithSource(request)).toEqual({
      user: { id: "token-actor", isActive: true },
      credentialSource: "bearer",
    });
  });

  test("a selected session validity capability retains its receiver and can revoke a fresh account", async () => {
    class Registry {
      #active = false;
      async hasActiveBrowserSession() {
        return this.#active;
      }
    }
    const guard = new SessionGuard(accounts, {
      ...session,
      read: () => ({ userId: 1, role: "member", issuedAt: Date.now() }),
      validity: new Registry(),
    });
    expect(await guard.resolve(new Request("http://example.test/"))).toBeNull();
  });

  test("supplied invalid bearer and Basic credentials never fall through to a valid session", async () => {
    let sessionReads = 0;
    const auth = createMetadataAuthManager(
      { ...accounts, ...email, resolveUserFromToken: async () => null },
      {
        ...options(["api", "basic", "session"]),
        readSession: () => {
          sessionReads++;
          return { userId: 1, role: "member", issuedAt: Date.now() };
        },
      },
      recover,
    );
    for (const authorization of ["Bearer invalid", `Basic ${btoa("unknown:invalid")}`]) {
      expect(
        await auth.resolve(new Request("http://example.test/", { headers: { authorization } })),
      ).toBeNull();
    }
    expect(sessionReads).toBe(0);
  });

  test("Basic checks MFA only for the exact account authenticated by the verifier", async () => {
    let consumed = 0;
    const record = { id: 2, role: "admin", mfa_enabled: false };
    const accounts = { findByIdOrThrow: async () => record };
    const credentials = { verifyCredentials: async () => ({ id: 1, role: "admin" }) };
    const request = new Request("http://example.test/", {
      headers: { authorization: `Basic ${btoa("user:password")}` },
    });
    const persistRecovery = async () => {
      consumed++;
      return true;
    };
    const byId = new BasicAuthGuard({ accounts, credentials, persistRecovery });
    const byEmail = new BasicAuthGuard({
      accounts,
      credentials,
      emailLookup: { findByEmail: async () => record },
      persistRecovery,
    });
    expect(await byId.resolve(request)).toBeNull();
    expect(await byEmail.resolve(request)).toBeNull();
    expect(consumed).toBe(0);
    for (const id of ["invalid", "", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      let lookups = 0;
      const guard = new BasicAuthGuard({
        accounts: {
          findByIdOrThrow: async () => {
            lookups++;
            return record;
          },
        },
        credentials: { verifyCredentials: async () => ({ id }) },
        persistRecovery,
      });
      expect(await guard.resolve(request)).toBeNull();
      expect(lookups).toBe(0);
    }
  });

  test("direct guards reject missing or malformed explicitly selected ports before requests", () => {
    for (const tokens of [undefined, {}, { resolveUserFromToken: true }]) {
      expect(() => new DatabaseTokenGuard(tokens as never)).toThrow(TypeError);
    }
    expect(() => new JwtGuard({ directory: {} as never, secret })).toThrow(TypeError);
    expect(() => new JwtGuard({ directory: accounts, secret: "" })).toThrow(TypeError);
    expect(() => new SessionGuard(accounts, { ...session, validity: undefined as never })).toThrow(
      TypeError,
    );
    expect(() => new SessionGuard(accounts, { ...session, validity: {} as never })).toThrow(
      TypeError,
    );
    expect(() => new BasicAuthGuard({ accounts, persistRecovery: recover } as never)).toThrow(
      TypeError,
    );
    expect(
      () => new BasicAuthGuard({ accounts, emailLookup: {} as never, persistRecovery: recover }),
    ).toThrow(TypeError);
    expect(
      () => new BasicAuthGuard({ accounts, credentials: {} as never, persistRecovery: recover }),
    ).toThrow(TypeError);
  });
});
