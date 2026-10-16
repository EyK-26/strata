import { describe, expect, test } from "bun:test";
import {
  AUTH_ONE_TIME_PURPOSES,
  consumeOneTimeToken,
  generateOneTimeToken,
  hashOneTimeToken,
  revokeUserSessions,
} from "@getstrata/core/auth/oneTimeToken";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";

describe("oneTimeToken", () => {
  test("generates a hashed token pair", () => {
    const token = generateOneTimeToken();
    expect(token.plain).toMatch(/^[a-f0-9]{64}$/u);
    expect(token.hash).toBe(hashOneTimeToken(token.plain));
    expect(token.hash).not.toBe(token.plain);
    expect(hashOneTimeToken(`  ${token.plain}  `)).toBe(token.hash);
  });

  test("exposes reset and verify purposes", () => {
    expect(AUTH_ONE_TIME_PURPOSES.passwordReset).toBe("password_reset");
    expect(AUTH_ONE_TIME_PURPOSES.emailVerify).toBe("email_verify");
  });

  test("consumeOneTimeToken returns null for an empty token", async () => {
    const sql = {
      async unsafe<T>(): Promise<T[]> {
        return [{ user_id: 1 }] as T[];
      },
    };
    expect(await consumeOneTimeToken(sql, AUTH_ONE_TIME_PURPOSES.passwordReset, "   ")).toBeNull();
  });

  test("consumeOneTimeToken uses a returning row on postgres", async () => {
    const issued = generateOneTimeToken();
    const queries: string[] = [];
    const sql = {
      async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
        queries.push(query);
        expect(params[2]).toBe(issued.hash);
        return [{ user_id: 9 }] as T[];
      },
    };
    await runWithSqlDialect("pgsql", async () => {
      expect(
        await consumeOneTimeToken(sql, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
      ).toBe(9);
    });
    expect(queries[0]).toContain("consumed_at IS NULL");
    expect(queries[0]).toContain("RETURNING");
  });

  test("consumeOneTimeToken returns null when returning misses", async () => {
    const issued = generateOneTimeToken();
    const sql = {
      async unsafe<T>(): Promise<T[]> {
        return [] as T[];
      },
    };
    await runWithSqlDialect("pgsql", async () => {
      expect(
        await consumeOneTimeToken(sql, AUTH_ONE_TIME_PURPOSES.emailVerify, issued.plain),
      ).toBeNull();
    });
  });

  test("consumeOneTimeToken uses affected rows on mysql", async () => {
    const issued = generateOneTimeToken();
    const calls: string[] = [];
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        calls.push(query);
        if (query.includes("UPDATE")) {
          return [{ affectedRows: 1 }] as T[];
        }
        return [{ user_id: 4 }] as T[];
      },
    };
    await runWithSqlDialect("mysql", async () => {
      expect(
        await consumeOneTimeToken(sql, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
      ).toBe(4);
    });
    expect(calls[0]).not.toContain("RETURNING");
    expect(calls[1]).toContain("SELECT user_id");
  });

  test("consumeOneTimeToken returns null when mysql updates zero rows", async () => {
    const issued = generateOneTimeToken();
    const sql = {
      async unsafe<T>(): Promise<T[]> {
        return [{ affectedRows: 0 }] as T[];
      },
    };
    await runWithSqlDialect("mysql", async () => {
      expect(
        await consumeOneTimeToken(sql, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
      ).toBeNull();
    });
  });

  test("consumeOneTimeToken returns null when mysql select misses after update", async () => {
    const issued = generateOneTimeToken();
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("UPDATE")) {
          return [{ changes: 1 }] as T[];
        }
        return [] as T[];
      },
    };
    await runWithSqlDialect("mysql", async () => {
      expect(
        await consumeOneTimeToken(sql, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
      ).toBeNull();
    });
  });

  test("revokeUserSessions updates the watermark and deletes sessions and tokens", async () => {
    const queries: string[] = [];
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        queries.push(query);
        return [] as T[];
      },
    };
    await runWithSqlDialect("sqlite", () => revokeUserSessions(sql, 3));
    expect(queries[0]).toContain("session_valid_after");
    expect(queries[0]).not.toContain("auth_version");
    expect(queries[1]).toContain("DELETE FROM sessions");
    expect(queries[2]).toContain("DELETE FROM api_tokens");
  });

  test("revokeUserSessions can keep api tokens", async () => {
    const queries: string[] = [];
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        queries.push(query);
        return [] as T[];
      },
    };
    await runWithSqlDialect("sqlite", () => revokeUserSessions(sql, 3, { revokeApiTokens: false }));
    expect(queries.some((query) => query.includes("DELETE FROM api_tokens"))).toBe(false);
  });

  test("revokeUserSessions swallows a missing sessions table", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("DELETE FROM sessions")) {
          throw new Error("no such table: sessions");
        }
        return [] as T[];
      },
    };
    await expect(
      runWithSqlDialect("sqlite", () => revokeUserSessions(sql, 8)),
    ).resolves.toBeUndefined();
  });

  test("revokeUserSessions rethrows a real delete error", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("DELETE FROM sessions")) {
          throw new Error("connection reset");
        }
        return [] as T[];
      },
    };
    await expect(runWithSqlDialect("sqlite", () => revokeUserSessions(sql, 8))).rejects.toThrow(
      "connection reset",
    );
  });

  test("revokeUserSessions swallows a missing api_tokens table", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("DELETE FROM api_tokens")) {
          throw new Error("ER_NO_SUCH_TABLE");
        }
        return [] as T[];
      },
    };
    await expect(
      runWithSqlDialect("sqlite", () => revokeUserSessions(sql, 8)),
    ).resolves.toBeUndefined();
  });

  test("revokeUserSessions rethrows a real api token delete error", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("DELETE FROM api_tokens")) {
          throw new Error("deadlock");
        }
        return [] as T[];
      },
    };
    await expect(runWithSqlDialect("sqlite", () => revokeUserSessions(sql, 8))).rejects.toThrow(
      "deadlock",
    );
  });
  test("Postgres concurrent DDL errors after optional-table lookup fail closed", async () => {
    const queries: string[] = [];
    const sql = {
      async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
        queries.push(query);
        if (query.includes("to_regclass")) return [{ relation: params[0] }] as T[];
        if (query.includes("DELETE")) throw new Error("relation does not exist");
        return [] as T[];
      },
    };
    await expect(runWithSqlDialect("pgsql", () => revokeUserSessions(sql, 8))).rejects.toThrow(
      "relation does not exist",
    );
    expect(queries.some((query) => query.includes("to_regclass"))).toBe(true);
  });
});
