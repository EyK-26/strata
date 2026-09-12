import { describe, expect, test } from "bun:test";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { AuthManager, DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { signJwt, verifyJwt } from "@getstrata/core/auth/jwt";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { hashPassword } from "@getstrata/core/auth/password";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { restoreEnvVar } from "../helpers/restoreEnv";

function directoryContainer(directory: AuthUserDirectory | null) {
  return {
    has(token: string) {
      return directory !== null && token === CORE_AUTH_USER_DIRECTORY_TOKEN;
    },
    resolve<T>(_key: string): T {
      if (!directory) {
        throw new Error("missing directory");
      }
      return directory as T;
    },
  };
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
      const guard = new JwtGuard({ directory: jwtDirectory() });
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
        await new JwtGuard().resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toBeNull();
      const enrolled = new JwtGuard({
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
      const auth = new AuthManager(new DatabaseTokenGuard(directoryContainer(directory)));
      auth.registerGuard("api", new DatabaseTokenGuard(directoryContainer(directory)));
      auth.registerGuard("jwt", new JwtGuard({ directory }));

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
      expect(() => auth.registerGuard("  ", new JwtGuard({ directory }))).toThrow(
        "Auth guard name must not be empty.",
      );

      const bearerMiss = new AuthManager({
        resolve() {
          return { id: 99, role: "fallback" };
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
      auth.registerGuard("basic", new BasicAuthGuard(directoryContainer(basicDirectory)));
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
    const guard = new BasicAuthGuard(directoryContainer(directory));
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
    const mfaGuard = new BasicAuthGuard(directoryContainer(mfaDirectory));
    expect(
      await mfaGuard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toBeNull();
  });

  test("persists a consumed recovery code on Basic login", async () => {
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
    bindDatabaseConnection({
      async unsafe(_query: string, params: readonly unknown[] = []) {
        stored = String(params[0]);
        return [];
      },
    } as never);
    try {
      const guard = new BasicAuthGuard(directoryContainer(directory));
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
    } finally {
      resetBoundDatabaseConnection();
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
    const guard = new BasicAuthGuard(directoryContainer(directory));
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
    const mfaGuard = new BasicAuthGuard(directoryContainer(mfaDirectory));
    expect(
      await mfaGuard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toBeNull();
  });

  test("returns null without a user directory", async () => {
    const guard = new BasicAuthGuard(directoryContainer(null));
    const encoded = Buffer.from("a:b").toString("base64");
    expect(
      await guard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toBeNull();

    const emptyDirectory: AuthUserDirectory = {
      async resolveUserFromToken() {
        return null;
      },
      async findByIdOrThrow(id) {
        return { id, role: "admin" };
      },
    };
    const withoutLookup = new BasicAuthGuard(directoryContainer(emptyDirectory));
    expect(
      await withoutLookup.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toBeNull();
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
    const guard = new BasicAuthGuard(directoryContainer(directory));
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
