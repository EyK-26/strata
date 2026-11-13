import { describe, expect, test } from "bun:test";
import {
  completePasswordLogin,
  persistConsumedRecoveryHash,
} from "@getstrata/core/auth/passwordLogin";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { generateRecoveryCodes, hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";
import { withBoundDatabase } from "../helpers/boundRepositoryHarness";

async function withSql<T>(
  connection: { unsafe: <R>(query: string, params?: readonly unknown[]) => Promise<R[]> },
  driver: "pgsql" | "mysql",
  work: (database: DatabaseSession) => Promise<T>,
): Promise<T> {
  return withBoundDatabase(
    {
      definition: {
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
      },
      connection,
      driver,
    },
    (database) => work(database),
  );
}

describe("completePasswordLogin", () => {
  test("allows users without MFA", () => {
    expect(completePasswordLogin({ mfa_enabled: false })).toEqual({ ok: true });
  });

  test("requires an MFA code when enabled", () => {
    expect(completePasswordLogin({ mfa_enabled: true, mfa_secret: generateTotpSecret() })).toEqual({
      ok: false,
      error: "mfa_required",
    });
  });

  test("accepts a valid TOTP code", () => {
    const secret = generateTotpSecret();
    const code = generateTotp(secret, Math.floor(Date.now() / 30_000));
    expect(
      completePasswordLogin({ mfa_enabled: true, mfa_secret: secret }, { mfaCode: code }),
    ).toEqual({ ok: true });
  });

  test("accepts a recovery code and reports the consumed hash", () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(String(code));
    const result = completePasswordLogin(
      {
        mfa_enabled: true,
        mfa_secret: generateTotpSecret(),
        mfa_recovery_codes: JSON.stringify([hash]),
      },
      { mfaCode: code },
    );
    expect(result).toEqual({ ok: true, consumedRecoveryHash: hash });
  });

  test("rejects an invalid MFA code", () => {
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "not-json" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "[]" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "[1,2]" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: "" },
        { mfaCode: "000000" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
  });

  test("persistConsumedRecoveryHash is a no-op without a consumed hash", async () => {
    const sql = {
      unsafe: async () => {
        throw new Error("should not write");
      },
    };
    await withSql(sql, "pgsql", (database) =>
      persistConsumedRecoveryHash(database, 1, "[]", undefined),
    );
  });

  test("persistConsumedRecoveryHash removes the consumed hash", async () => {
    const keep = hashRecoveryCode("keep-code");
    const used = hashRecoveryCode("used-code");
    let stored = "";
    const sql = {
      async unsafe<T>(_query: string, params: readonly unknown[] = []) {
        stored = String(params[0]);
        return [{ id: 4 }] as T[];
      },
    };
    await withSql(sql, "pgsql", (database) =>
      persistConsumedRecoveryHash(database, 4, JSON.stringify([keep, used]), used),
    );
    expect(JSON.parse(stored)).toEqual([keep]);
  });
  test("recovery persistence rejects malformed or stale claims without accepting an unchecked write", async () => {
    const sql = {
      unsafe: async () => {
        throw new Error("must not query");
      },
    };
    for (const raw of [null, undefined, "[]", "invalid", "[1]"]) {
      await expect(
        withSql(sql, "pgsql", (database) => persistConsumedRecoveryHash(database, 1, raw, "used")),
      ).rejects.toMatchObject({
        status: 422,
        message: "mfa_invalid",
      });
    }
    for (const rows of [[], [null], [{}], [{ affectedRows: 0 }], [{ affectedRows: 2 }]]) {
      const empty = { unsafe: async <T>() => rows as T[] };
      await withSql(empty, "mysql", async (database) => {
        await expect(
          persistConsumedRecoveryHash(database, 1, '["used"]', "used"),
        ).rejects.toMatchObject({ status: 422 });
      });
    }
    await withSql({ unsafe: async <T>() => [{ affectedRows: 1 }] as T[] }, "mysql", (database) =>
      persistConsumedRecoveryHash(database, 1, '["used"]', "used"),
    );
    await withSql({ unsafe: async () => [] }, "pgsql", async (database) => {
      await expect(
        persistConsumedRecoveryHash(database, 1, '["used"]', "used"),
      ).rejects.toMatchObject({ status: 422 });
    });
    await expect(
      withSql(
        {
          unsafe: async () => {
            throw new Error("database unavailable");
          },
        },
        "pgsql",
        (database) => persistConsumedRecoveryHash(database, 1, '["used"]', "used"),
      ),
    ).rejects.toMatchObject({
      code: "DATABASE_OPERATION_FAILED",
      cause: { message: "database unavailable" },
    });
  });
});

test("non-array recovery-code JSON cannot authorize an MFA login", () => {
  for (const input of ["null", "{}", '"not-a-list"'])
    expect(
      completePasswordLogin(
        { mfa_enabled: true, mfa_secret: generateTotpSecret(), mfa_recovery_codes: input },
        { mfaCode: "invalid" },
      ),
    ).toEqual({ ok: false, error: "mfa_invalid" });
});
