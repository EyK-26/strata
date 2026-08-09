import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { jwtTtlSeconds, signJwt, verifyJwt } from "@getstrata/core/auth/jwt";
import { restoreEnvVar } from "../helpers/restoreEnv";

function signedToken(payload: object, secret: string, alg = "HS256"): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${data}`).digest("base64url");
  return `${header}.${data}.${signature}`;
}

describe("jwt helpers", () => {
  test("honors ttl override and JWT_TTL_SECONDS", () => {
    const previous = process.env.JWT_TTL_SECONDS;
    process.env.JWT_TTL_SECONDS = "120";
    try {
      expect(jwtTtlSeconds()).toBe(120);
      expect(jwtTtlSeconds(90)).toBe(90);
    } finally {
      restoreEnvVar("JWT_TTL_SECONDS", previous);
    }

    const invalid = process.env.JWT_TTL_SECONDS;
    process.env.JWT_TTL_SECONDS = "nope";
    try {
      expect(jwtTtlSeconds()).toBe(3600);
      expect(jwtTtlSeconds(1.5)).toBe(3600);
      expect(jwtTtlSeconds(0)).toBe(3600);
    } finally {
      restoreEnvVar("JWT_TTL_SECONDS", invalid);
    }
  });

  test("verifyJwt rejects wrong algorithm, missing subject, expiry, and garbage", () => {
    const previousJwt = process.env.JWT_SECRET;
    const previousSession = process.env.SESSION_SECRET;
    process.env.JWT_SECRET = "unit-jwt-secret-unit-jwt-secret";
    try {
      expect(verifyJwt(signedToken({ sub: 1 }, process.env.JWT_SECRET, "none"))).toBeNull();
      expect(verifyJwt(signedToken({ role: "admin" }, process.env.JWT_SECRET))).toBeNull();
      expect(verifyJwt(signedToken({ sub: 1, exp: 1 }, process.env.JWT_SECRET))).toBeNull();
      expect(verifyJwt("a.b")).toBeNull();
      expect(verifyJwt("a.b.c")).toBeNull();
      expect(verifyJwt(".b.c")).toBeNull();
      expect(verifyJwt("a..c")).toBeNull();

      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      );
      const data = "@@@";
      const signature = createHmac("sha256", process.env.JWT_SECRET)
        .update(`${header}.${data}`)
        .digest("base64url");
      expect(verifyJwt(`${header}.${data}.${signature}`)).toBeNull();

      const valid = signJwt({ sub: "candidate-2" }, { secret: process.env.JWT_SECRET });
      expect(verifyJwt(valid, process.env.JWT_SECRET)?.sub).toBe("candidate-2");
      expect(verifyJwt(signedToken({ sub: null }, process.env.JWT_SECRET))).toBeNull();

      const badHeader = Buffer.from("not-json").toString("base64url");
      const okPayload = Buffer.from(JSON.stringify({ sub: 1 })).toString("base64url");
      const badHeaderSig = createHmac("sha256", process.env.JWT_SECRET)
        .update(`${badHeader}.${okPayload}`)
        .digest("base64url");
      expect(verifyJwt(`${badHeader}.${okPayload}.${badHeaderSig}`)).toBeNull();

      delete process.env.JWT_SECRET;
      process.env.SESSION_SECRET = "session-secret-for-jwt-fallback-tests";
      const fromSession = signJwt({ sub: 7 });
      expect(verifyJwt(fromSession, "session-secret-for-jwt-fallback-tests")?.sub).toBe(7);

      delete process.env.SESSION_SECRET;
      const fromDev = signJwt({ sub: 3 });
      expect(verifyJwt(fromDev)?.sub).toBe(3);
    } finally {
      restoreEnvVar("JWT_SECRET", previousJwt);
      restoreEnvVar("SESSION_SECRET", previousSession);
    }
  });
});
