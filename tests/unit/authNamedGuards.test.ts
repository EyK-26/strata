import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { AuthManager, DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { signJwt, verifyJwt } from "@getstrata/core/auth/jwt";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { hashPassword } from "@getstrata/core/auth/password";
import { persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";
import type {
  AuthCredentialVerifier,
  AuthEmailLookup,
  AuthUserDirectory,
  AuthUserRecord,
} from "@getstrata/core/contracts/authUserDirectory";
import { AuthAccountNotFoundError } from "@getstrata/core/contracts/authUserDirectory";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { authFixtureOutcome } from "../helpers/authOutcome";
import { withBoundDatabase } from "../helpers/boundRepositoryHarness";
import { restoreEnvVar } from "../helpers/restoreEnv";

function basic(
  directory: AuthUserDirectory | null,
  persistRecovery: (record: AuthUserRecord, hash: string) => Promise<boolean> = async () => false,
) {
  const accounts = directory as AuthUserDirectory;
  const emailLookup = directory?.findByEmail ? (directory as AuthEmailLookup) : undefined;
  const credentials = directory?.verifyCredentials
    ? (directory as AuthCredentialVerifier)
    : undefined;
  return emailLookup
    ? new BasicAuthGuard({
        mfaSecrets: createMfaSecretCodec(process.env),
        accounts,
        emailLookup,
        credentials,
        persistRecovery,
      })
    : new BasicAuthGuard({
        mfaSecrets: createMfaSecretCodec(process.env),
        accounts,
        credentials: credentials as AuthCredentialVerifier,
        persistRecovery,
      });
}
async function withRecoverySql<T>(
  connection: { unsafe: <R>(sql: string, params?: readonly unknown[]) => Promise<R[]> },
  directory: AuthUserDirectory,
  work: (guard: BasicAuthGuard) => Promise<T>,
): Promise<T> {
  return withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
      },
      connection,
    },
    async (database) =>
      work(
        basic(directory, async (record, hash) => {
          await persistConsumedRecoveryHash(database, record.id, record.mfa_recovery_codes, hash);
          return true;
        }),
      ),
  );
}

function jwtDirectory(
  lookup: (id: number) => {
    id: number;
    role: string;
    session_valid_after?: Date | string | null;
    mfa_enabled?: boolean;
    mfa_secret?: string | null;
  } = (id) => ({ id, role: "admin" }),
): AuthUserDirectory {
  return {
    async resolveUserFromToken() {
      return null;
    },
    async findByIdOrThrow(id) {
      return lookup(id);
    },
  };
}

describe("JWT tokens", () => {
  test("signs and verifies a payload", () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    try {
      const token = signJwt({ sub: 42, role: "recruiter", abilities: ["applications:read"] });
      const payload = verifyJwt(token);
      expect(payload?.sub).toBe(42);
      expect(payload?.role).toBe("recruiter");
      expect(payload?.abilities).toEqual(["applications:read"]);
    } finally {
      restoreEnvVar("JWT_SECRET", previous);
    }
  });

  test("JWT issuance preserves ordering within a revocation second without admitting old tokens", async () => {
    const originalNow = Date.now;
    const second = Math.floor(originalNow() / 1000) * 1000;
    let now = second + 100;
    Date.now = () => now;
    const secret = "unit-precision-jwt-secret-at-least-32-characters";
    const cutoff = new Date(second + 500);
    const guard = new JwtGuard({
      secret,
      directory: jwtDirectory((id) => ({ id, role: "admin", session_valid_after: cutoff })),
    });
    const request = (token: string) =>
      new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } });
    try {
      const old = signJwt({ sub: 9, iat: 0 }, { secret, ttlSeconds: 60 });
      now = second + 499;
      const before = signJwt({ sub: 9 }, { secret, ttlSeconds: 60 });
      now = second + 500;
      const equal = signJwt({ sub: 9 }, { secret, ttlSeconds: 60 });
      now = second + 501;
      const after = signJwt({ sub: 9 }, { secret, ttlSeconds: 60 });
      expect(await guard.resolve(request(old))).toBeNull();
      expect(await guard.resolve(request(before))).toBeNull();
      expect(await guard.resolve(request(equal))).toEqual({ id: 9 });
      expect(await guard.resolve(request(after))).toEqual({ id: 9 });
      expect(verifyJwt(after, secret)?.iat).toBe((second + 501) / 1000);
      expect(verifyJwt(after, secret)?.exp).toBe(second / 1000 + 60);
      now = second;
      const integerIssued = signJwt({ sub: 9 }, { secret, ttlSeconds: 60 });
      expect(Number.isInteger(verifyJwt(integerIssued, secret)?.iat)).toBe(true);
      const unchangedCutoff = new JwtGuard({
        secret,
        directory: jwtDirectory((id) => ({
          id,
          role: "admin",
          session_valid_after: new Date(second),
        })),
      });
      expect(await unchangedCutoff.resolve(request(integerIssued))).toEqual({ id: 9 });
      expect(await guard.resolve(request(integerIssued))).toBeNull();
      now = second + 60_000;
      expect(await guard.resolve(request(after))).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });

  test("JwtGuard authenticates a bearer JWT and ignores opaque tokens", async () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    try {
      const token = signJwt({
        sub: 9,
        role: "admin",
        abilities: ["*"],
        emailVerifiedAt: null,
      });
      const guard = new JwtGuard({
        secret: process.env.JWT_SECRET ?? "explicit-test-secret-at-least-32-characters",
        directory: jwtDirectory(),
      });
      const custom = new JwtGuard({
        secret: "a-different-jwt-secret-value",
        directory: jwtDirectory(),
      });
      expect(await guard.resolve(new Request("http://example.test"))).toBeNull();
      expect(
        await guard.resolve(
          new Request("http://example.test", { headers: { authorization: "Bearer abc" } }),
        ),
      ).toBeNull();
      expect(
        await guard.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toEqual({
        id: 9,
        role: "admin",
        abilities: ["*"],
        emailVerifiedAt: null,
      });
      expect(
        await custom.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toBeNull();
      expect(
        await guard.resolve(
          new Request("http://example.test", {
            headers: {
              authorization: `Bearer ${signJwt({ sub: 5 }, { secret: process.env.JWT_SECRET })}`,
            },
          }),
        ),
      ).toEqual({ id: 5 });
      expect(
        () =>
          new JwtGuard({
            secret: process.env.JWT_SECRET ?? "explicit-test-secret-at-least-32-characters",
            directory: undefined as unknown as AuthUserDirectory,
          }),
      ).toThrow(TypeError);
      const enrolled = new JwtGuard({
        secret: process.env.JWT_SECRET ?? "explicit-test-secret-at-least-32-characters",
        directory: jwtDirectory(() => ({
          id: 9,
          role: "admin",
          mfa_enabled: true,
          mfa_secret: "secret",
        })),
      });
      expect(
        await enrolled.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toEqual({
        id: 9,
        role: "admin",
        abilities: ["*"],
        emailVerifiedAt: null,
      });
      const revoked = new JwtGuard({
        secret: process.env.JWT_SECRET ?? "explicit-test-secret-at-least-32-characters",
        directory: jwtDirectory(() => ({
          id: 9,
          role: "admin",
          session_valid_after: new Date(Date.now() + 60_000),
        })),
      });
      expect(
        await revoked.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toBeNull();
    } finally {
      restoreEnvVar("JWT_SECRET", previous);
    }
  });
});

describe("named auth guards", () => {
  test("AuthManager picks opaque tokens, JWTs, then session by credential type", async () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    try {
      const directory: AuthUserDirectory = {
        async resolveUserFromToken(token) {
          return token === "hiring-token" ? { id: 3, role: "recruiter", abilities: ["*"] } : null;
        },
        async findByIdOrThrow(id) {
          return { id, role: "recruiter" };
        },
      };
      const auth = new AuthManager(new DatabaseTokenGuard(directory));
      auth.registerGuard("api", new DatabaseTokenGuard(directory));
      auth.registerGuard(
        "jwt",
        new JwtGuard({
          secret: process.env.JWT_SECRET ?? "explicit-test-secret-at-least-32-characters",
          directory,
        }),
      );

      expect(
        await auth.resolve(
          new Request("http://example.test", { headers: { authorization: "Bearer hiring-token" } }),
        ),
      ).toEqual({ id: 3, role: "recruiter", abilities: ["*"] });

      const jwt = signJwt({ sub: 11, role: "admin" });
      expect(
        await auth.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${jwt}` } }),
        ),
      ).toEqual({ id: 11, role: "admin" });

      expect(auth.guardNames()).toContain("api");
      expect(auth.use("jwt")).toBeInstanceOf(JwtGuard);
      expect(() => auth.use("missing")).toThrow('Unknown auth guard "missing"');
      expect(() =>
        auth.registerGuard(
          "  ",
          new JwtGuard({
            secret: process.env.JWT_SECRET ?? "explicit-test-secret-at-least-32-characters",
            directory,
          }),
        ),
      ).toThrow("Auth guard name must not be empty.");

      const bearerMiss = new AuthManager({
        authenticate() {
          return authFixtureOutcome(
            (async () => {
              return { id: 99, role: "fallback" };
            })(),
          );
        },
      });
      expect(
        await bearerMiss.resolve(
          new Request("http://example.test", { headers: { authorization: "Bearer nope" } }),
        ),
      ).toBeNull();
      expect(
        await bearerMiss.resolveWithSource(
          new Request("http://example.test", { headers: { authorization: "Bearer nope" } }),
        ),
      ).toEqual({ user: null, credentialSource: null });

      const basicDirectory: AuthUserDirectory = {
        async resolveUserFromToken() {
          return null;
        },
        async findByIdOrThrow(id) {
          return { id, role: "admin" };
        },
        async verifyCredentials(email, password) {
          return email === "basic@hiroapp.test" && password === "ok"
            ? { id: 8, role: "admin" }
            : null;
        },
      };
      auth.registerGuard("basic", basic(basicDirectory));
      const basicHeader = Buffer.from("basic@hiroapp.test:ok").toString("base64");
      expect(
        await auth.resolve(
          new Request("http://example.test", {
            headers: { authorization: `Basic ${basicHeader}` },
          }),
        ),
      ).toEqual({ id: 8, role: "admin" });
    } finally {
      restoreEnvVar("JWT_SECRET", previous);
    }
  });
});

describe("HTTP Basic guard", () => {
  test("authenticates email and password from the Basic header", async () => {
    const password = await hashPassword("secret-pass");
    const directory: AuthUserDirectory = {
      async resolveUserFromToken() {
        return null;
      },
      async findByIdOrThrow(id) {
        return { id, role: "admin", password };
      },
      async findByEmail(email) {
        if (email !== "admin@hiroapp.test") {
          return null;
        }
        return {
          id: 1,
          role: "admin",
          password,
          email_verified_at: "2026-01-01T00:00:00.000Z",
        };
      },
    };
    const guard = basic(directory);
    const encoded = Buffer.from("admin@hiroapp.test:secret-pass").toString("base64");
    expect(await guard.resolve(new Request("http://example.test"))).toBeNull();
    expect(
      await guard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toEqual({
      id: 1,
      role: "admin",
      emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    });

    const mfaDirectory: AuthUserDirectory = {
      ...directory,
      async findByEmail(email) {
        const row = await directory.findByEmail?.(email);
        return row ? { ...row, mfa_enabled: true, mfa_secret: "secret" } : null;
      },
    };
    const mfaGuard = basic(mfaDirectory);
    expect(
      await mfaGuard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toBeNull();
  });

  test("persists a consumed recovery code on Basic login", async () => {
    const previousTenancy = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
    const password = await hashPassword("secret-pass");
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(String(code));
    const directory: AuthUserDirectory = {
      async resolveUserFromToken() {
        return null;
      },
      async findByIdOrThrow(id) {
        return { id, role: "admin", password };
      },
      async findByEmail(email) {
        if (email !== "admin@hiroapp.test") {
          return null;
        }
        return {
          id: 1,
          role: "admin",
          password,
          mfa_enabled: true,
          mfa_secret: "unused",
          mfa_recovery_codes: JSON.stringify([hash]),
        };
      },
    };
    let stored = "";
    const sql = {
      async unsafe<T>(_query: string, params: readonly unknown[] = []) {
        stored = String(params[0]);
        return [{ id: 1 }] as T[];
      },
    };
    try {
      await withRecoverySql(sql, directory, async (guard) => {
        const encoded = Buffer.from("admin@hiroapp.test:secret-pass").toString("base64");
        expect(
          await guard.resolve(
            new Request("http://example.test", {
              headers: {
                authorization: `Basic ${encoded}`,
                "x-mfa-code": String(code),
              },
            }),
          ),
        ).toEqual({ id: 1, role: "admin", emailVerifiedAt: null });
        expect(JSON.parse(stored)).toEqual([]);
      });
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previousTenancy);
    }
  });

  test("Basic authentication denies stale recovery claims in both directory paths and propagates database failures", async () => {
    const before = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";
    const password = await hashPassword("secret-pass");
    const [code] = generateRecoveryCodes(1);
    const raw = JSON.stringify([hashRecoveryCode(String(code))]);
    try {
      for (const directPassword of [true, false]) {
        const directory: AuthUserDirectory = {
          resolveUserFromToken: async () => null,
          findByIdOrThrow: async (id) => ({ id, role: "member" }),
          findByEmail: async () => ({
            id: 1,
            role: "member",
            password: directPassword ? password : undefined,
            mfa_enabled: true,
            mfa_secret: "unused",
            mfa_recovery_codes: raw,
          }),
          verifyCredentials: async () => ({ id: 1 }),
        };
        const request = new Request("http://example.test", {
          headers: {
            authorization: `Basic ${Buffer.from("fixture:secret-pass").toString("base64")}`,
            "x-mfa-code": String(code),
          },
        });
        await withRecoverySql({ unsafe: async () => [] }, directory, async (guard) => {
          expect(await guard.resolve(request)).toBeNull();
        });
        await expect(
          withRecoverySql(
            {
              unsafe: async () => {
                throw new Error("SQL unavailable");
              },
            },
            directory,
            (guard) => guard.resolve(request),
          ),
        ).rejects.toMatchObject({
          code: "DATABASE_OPERATION_FAILED",
          cause: { message: "SQL unavailable" },
        });
      }
    } finally {
      restoreEnvVar("TENANCY_DRIVER", before);
    }
  });

  test("uses verifyCredentials when the directory provides it", async () => {
    const directory: AuthUserDirectory = {
      async resolveUserFromToken() {
        return null;
      },
      async findByIdOrThrow(id) {
        return { id, role: "recruiter" };
      },
      async verifyCredentials(email, password) {
        if (email === "recruiter@hiroapp.test" && password === "ok") {
          return { id: 4, role: "recruiter" };
        }
        return null;
      },
    };
    const guard = basic(directory);
    const encoded = Buffer.from("recruiter@hiroapp.test:ok").toString("base64");
    expect(
      await guard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toEqual({ id: 4, role: "recruiter" });

    const mfaDirectory: AuthUserDirectory = {
      ...directory,
      async findByIdOrThrow(id) {
        return { id, role: "recruiter", mfa_enabled: true, mfa_secret: "secret" };
      },
    };
    const mfaGuard = basic(mfaDirectory);
    expect(
      await mfaGuard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toBeNull();
  });

  test("rejects missing account or credential capabilities during construction", () => {
    expect(() => basic(null)).toThrow(TypeError);
    const emptyDirectory: AuthUserDirectory = {
      resolveUserFromToken: async () => null,
      findByIdOrThrow: async (id) => ({ id, role: "admin" }),
    };
    expect(() => basic(emptyDirectory)).toThrow(TypeError);
  });

  test("rejects malformed basic headers and unknown users", async () => {
    const password = await hashPassword("secret-pass");
    const directory: AuthUserDirectory = {
      async resolveUserFromToken() {
        return null;
      },
      async findByIdOrThrow(id) {
        return { id, role: "admin", password };
      },
      async findByEmail(email) {
        if (email === "nopass@hiroapp.test") {
          return { id: 2, role: "admin" };
        }
        if (email === "admin@hiroapp.test") {
          return { id: 1, role: "admin", password };
        }
        return null;
      },
    };
    const guard = basic(directory);
    expect(
      await guard.resolve(
        new Request("http://example.test", { headers: { authorization: "Basic " } }),
      ),
    ).toBeNull();
    expect(
      await guard.resolve(
        new Request("http://example.test", {
          headers: { authorization: `Basic ${Buffer.from("nocolon").toString("base64")}` },
        }),
      ),
    ).toBeNull();
    expect(
      await guard.resolve(
        new Request("http://example.test", {
          headers: {
            authorization: `Basic ${Buffer.from("missing@hiroapp.test:x").toString("base64")}`,
          },
        }),
      ),
    ).toBeNull();
    expect(
      await guard.resolve(
        new Request("http://example.test", {
          headers: {
            authorization: `Basic ${Buffer.from("nopass@hiroapp.test:x").toString("base64")}`,
          },
        }),
      ),
    ).toBeNull();
    expect(
      await guard.resolve(
        new Request("http://example.test", {
          headers: {
            authorization: `Basic ${Buffer.from("admin@hiroapp.test:wrong").toString("base64")}`,
          },
        }),
      ),
    ).toBeNull();
  });
});

test("legacy basic directories deny missing, inactive and deleted principals", async () => {
  const request = new Request("http://example.test", {
    headers: { authorization: `Basic ${Buffer.from("user:secret").toString("base64")}` },
  });
  for (const user of [
    null,
    { id: 1, role: "member", isActive: false },
    { id: 1, role: "member" },
  ]) {
    let lookups = 0;
    const directory: AuthUserDirectory = {
      async resolveUserFromToken() {
        return null;
      },
      async verifyCredentials() {
        return user;
      },
      async findByIdOrThrow() {
        lookups++;
        throw new AuthAccountNotFoundError();
      },
    };
    expect(await basic(directory).resolve(request)).toBeNull();
    expect(lookups).toBe(user && user.isActive !== false ? 1 : 0);
  }
});

test("signed JWTs still require finite issuance, a usable subject and a current directory record", async () => {
  const secret = "qualification-jwt-secret-with-sufficient-length";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = (payload: Record<string, unknown>) => {
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}`;
    return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
  };
  let lookups = 0;
  const guard = new JwtGuard({
    secret,
    directory: jwtDirectory(() => {
      lookups++;
      throw new AuthAccountNotFoundError();
    }),
  });
  const now = Math.floor(Date.now() / 1000);
  for (const payload of [
    { sub: 1 },
    { sub: 1, iat: "now" },
    { sub: 1, iat: null },
    { sub: "invalid", iat: now },
    { sub: 0, iat: now },
    { sub: 1, iat: now },
  ]) {
    expect(
      await guard.resolve(
        new Request("http://example.test", {
          headers: { authorization: `Bearer ${token(payload)}` },
        }),
      ),
    ).toBeNull();
  }
  expect(lookups).toBe(1);
});
