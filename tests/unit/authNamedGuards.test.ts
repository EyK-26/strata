import { describe, expect, test } from "bun:test";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { AuthManager, DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { signJwt, verifyJwt } from "@getstrata/core/auth/jwt";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { hashPassword } from "@getstrata/core/auth/password";
import type { AuthUserDirectory } from "@getstrata/core/contracts/authUserDirectory";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
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

  test("JwtGuard authenticates a bearer JWT and ignores opaque tokens", () => {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "unit-test-jwt-secret-unit-test-jwt";
    try {
      const token = signJwt({
        sub: 9,
        role: "admin",
        abilities: ["*"],
        emailVerifiedAt: null,
      });
      const guard = new JwtGuard();
      const custom = new JwtGuard({ secret: "a-different-jwt-secret-value" });
      expect(guard.resolve(new Request("http://example.test"))).toBeNull();
      expect(
        guard.resolve(
          new Request("http://example.test", { headers: { authorization: "Bearer abc" } }),
        ),
      ).toBeNull();
      expect(
        guard.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toEqual({
        id: 9,
        role: "admin",
        abilities: ["*"],
        emailVerifiedAt: null,
      });
      expect(
        custom.resolve(
          new Request("http://example.test", { headers: { authorization: `Bearer ${token}` } }),
        ),
      ).toBeNull();
      expect(
        guard.resolve(
          new Request("http://example.test", {
            headers: {
              authorization: `Bearer ${signJwt({ sub: 5 }, { secret: process.env.JWT_SECRET })}`,
            },
          }),
        ),
      ).toEqual({ id: 5 });
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
      auth.registerGuard("jwt", new JwtGuard());

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
      expect(() => auth.registerGuard("  ", new JwtGuard())).toThrow(
        "Auth guard name must not be empty.",
      );

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
        return { id: 1, role: "admin", password };
      },
    };
    const guard = new BasicAuthGuard(directoryContainer(directory));
    const encoded = Buffer.from("admin@hiroapp.test:secret-pass").toString("base64");
    expect(await guard.resolve(new Request("http://example.test"))).toBeNull();
    expect(
      await guard.resolve(
        new Request("http://example.test", { headers: { authorization: `Basic ${encoded}` } }),
      ),
    ).toEqual({ id: 1, role: "admin", emailVerifiedAt: null });
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
