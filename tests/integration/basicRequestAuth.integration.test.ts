import { expect, test } from "bun:test";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { AuthManager } from "@getstrata/core/auth/guard";
import { hashPassword } from "@getstrata/core/auth/password";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";
import { restoreEnvVar } from "../helpers/restoreEnv";

test("actual Basic HTTP middleware and controller resolve one recovery proof once per request", async () => {
  const encryptionBefore = process.env.KMS_ENCRYPTION_KEY;
  process.env.KMS_ENCRYPTION_KEY ??= "a".repeat(64);
  const before = process.env.TENANCY_DRIVER,
    bound = getBoundDatabaseConnection();
  process.env.TENANCY_DRIVER = "none";
  useSqlDialect("sqlite");
  const db = createSqliteConnection(":memory:");
  bindDatabaseConnection(db);
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const password = await hashPassword("fixture-password");
    const secret = generateTotpSecret();
    const [used, keep] = generateRecoveryCodes(2);
    expect(used).toBeDefined();
    expect(keep).toBeDefined();
    await db.unsafe("CREATE TABLE users(id INTEGER PRIMARY KEY,mfa_recovery_codes TEXT)");
    await db.unsafe("INSERT INTO users VALUES(1,?)", [
      JSON.stringify([hashRecoveryCode(String(used)), hashRecoveryCode(String(keep))]),
    ]);
    const container = new ServiceContainer();
    container.set(CORE_AUTH_USER_DIRECTORY_TOKEN, {
      resolveUserFromToken: async () => null,
      findByIdOrThrow: async (id: number) => ({ id, role: "member" }),
      findByEmail: async (email: string) => {
        if (email !== "fixture@example.test") return null;
        const [row] = await db.unsafe<{ mfa_recovery_codes: string }>(
          "SELECT mfa_recovery_codes FROM users WHERE id=1",
        );
        return {
          id: 1,
          role: "member",
          password,
          mfa_enabled: true,
          mfa_secret: protectMfaSecret(secret),
          mfa_recovery_codes: row?.mfa_recovery_codes,
        };
      },
    });
    const auth = new AuthManager(new BasicAuthGuard(container));
    const handler = composeMiddleware(createAuthMiddleware(auth))(
      withErrorHandling(async (request) => {
        const [user, allowed, again] = await Promise.all([
          auth.requireUser(request),
          auth.check(request),
          auth.user(request),
        ]);
        expect(allowed).toBe(true);
        expect(again?.id).toBe(user.id);
        return Response.json({ id: user.id });
      }),
    );
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
    const url = `http://127.0.0.1:${server.port}`;
    const get = (code: string) =>
      fetch(url, {
        headers: {
          authorization: `Basic ${Buffer.from("fixture@example.test:fixture-password").toString("base64")}`,
          "x-mfa-code": code,
        },
      });
    const responses = await Promise.all([get(String(used)), get(String(used))]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await responses.find((r) => r.status === 200)?.json()).toEqual({ id: 1 });
    expect((await get(String(used))).status).toBe(401);
    expect((await get(generateTotp(secret))).status).toBe(200);
    expect((await get(String(keep))).status).toBe(200);
    expect((await fetch(url)).status).toBe(401);
    expect(await db.unsafe("SELECT mfa_recovery_codes FROM users WHERE id=1")).toEqual([
      { mfa_recovery_codes: "[]" },
    ]);
  } finally {
    await server?.stop(true);
    db.close();
    if (bound) bindDatabaseConnection(bound);
    else resetBoundDatabaseConnection();
    restoreEnvVar("TENANCY_DRIVER", before);
    restoreEnvVar("KMS_ENCRYPTION_KEY", encryptionBefore);
    resetSqlDialect();
  }
});
