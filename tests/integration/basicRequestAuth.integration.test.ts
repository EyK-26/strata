import { expect, test } from "bun:test";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { AuthManager } from "@getstrata/core/auth/guard";
import { hashPassword } from "@getstrata/core/auth/password";
import { persistConsumedRecoveryHash } from "@getstrata/core/auth/passwordLogin";
import { protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";
import { createNativePersistenceApplication } from "../helpers/nativePersistenceApplication";
import { restoreEnvVar } from "../helpers/restoreEnv";

test("actual Basic HTTP middleware and controller resolve one recovery proof once per request", async () => {
  const encryptionBefore = process.env.KMS_ENCRYPTION_KEY;
  process.env.KMS_ENCRYPTION_KEY ??= "a".repeat(64);
  const owner = await createNativePersistenceApplication({
    default: "main",
    connections: { main: { driver: "sqlite", filename: ":memory:" } },
  });
  const invoke = createPersistenceInvocation(owner.application, "main");
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const password = await hashPassword("fixture-password");
    const secret = generateTotpSecret();
    const [used, keep] = generateRecoveryCodes(2);
    expect(used).toBeDefined();
    expect(keep).toBeDefined();
    await owner.run(async (database) => {
      await database.execute({
        text: "CREATE TABLE users(id INTEGER PRIMARY KEY,mfa_recovery_codes TEXT)",
        params: [],
      });
      await database.execute({
        text: "INSERT INTO users VALUES(1,?)",
        params: [JSON.stringify([hashRecoveryCode(String(used)), hashRecoveryCode(String(keep))])],
      });
    });
    // The transport formatter surrounds the actual invocation; it cannot turn an
    // authentication/controller failure into a successful persistence callback.
    const handler = withErrorHandling((request) =>
      invoke({ kind: "request" }, async ({ database }) => {
        const guard = new BasicAuthGuard({
          directory: {
            resolveUserFromToken: async () => null,
            findByIdOrThrow: async (id) => ({ id, role: "member" }),
            findByEmail: async (email) => {
              if (email !== "fixture@example.test") return null;
              const [row] = await database.execute<{ mfa_recovery_codes: string }>({
                text: "SELECT mfa_recovery_codes FROM users WHERE id=1",
                params: [],
              });
              return {
                id: 1,
                role: "member",
                password,
                mfa_enabled: true,
                mfa_secret: protectMfaSecret(secret),
                mfa_recovery_codes: row?.mfa_recovery_codes,
              };
            },
          },
          persistRecovery: async (record, hash) => {
            await persistConsumedRecoveryHash(database, record.id, record.mfa_recovery_codes, hash);
            return true;
          },
        });
        const auth = new AuthManager(guard);
        const controller = composeMiddleware(createAuthMiddleware(auth))(async (request) => {
          const [user, allowed, again] = await Promise.all([
            auth.requireUser(request),
            auth.check(request),
            auth.user(request),
          ]);
          expect(allowed).toBe(true);
          expect(again?.id).toBe(user.id);
          return Response.json({ id: user.id });
        });
        return controller(request);
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
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await responses.find((response) => response.status === 200)?.json()).toEqual({ id: 1 });
    expect((await get(String(used))).status).toBe(401);
    expect((await get(generateTotp(secret))).status).toBe(200);
    expect((await get(String(keep))).status).toBe(200);
    expect((await fetch(url)).status).toBe(401);
    await owner.run(async (database) =>
      expect(
        await database.execute({
          text: "SELECT mfa_recovery_codes FROM users WHERE id=1",
          params: [],
        }),
      ).toEqual([{ mfa_recovery_codes: "[]" }]),
    );
  } finally {
    await server?.stop(true);
    await owner.close();
    restoreEnvVar("KMS_ENCRYPTION_KEY", encryptionBefore);
  }
});
