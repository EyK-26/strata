import { describe, expect, test } from "bun:test";
import {
  AUTH_ONE_TIME_PURPOSES,
  consumeOneTimeToken,
  generateOneTimeToken,
  hashOneTimeToken,
  revokeUserSessions,
} from "@getstrata/core/auth/oneTimeToken";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { type SqlFixture, withRepositories } from "../helpers/boundRepositoryHarness";

function withSql<T>(
  driver: "pgsql" | "mysql" | "sqlite",
  sql: SqlFixture,
  work: (selected: DatabaseSession) => T | Promise<T>,
): Promise<T> {
  return withRepositories(sql, [], (_repositories, selected) => work(selected), driver);
}

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

  for (const driver of ["pgsql", "mysql", "sqlite"] as const) {
    test(`${driver} token consumption and revocation bind dialect-compatible timestamps`, async () => {
      const now = new Date("2026-10-19T09:25:53.338Z");
      const calls: { query: string; params: readonly unknown[] }[] = [];
      const sql = {
        async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
          calls.push({ query, params });
          if (query.includes("sqlite_master") || query.includes("information_schema.tables"))
            return [{ relation: "present" }] as T[];
          if (query.includes("to_regclass")) return [{ relation: params[0] }] as T[];
          return [{ user_id: 7, affectedRows: 1 }] as T[];
        },
      };
      await withSql(driver, sql, async (selected) => {
        expect(await consumeOneTimeToken(selected, "email_verify", "test", now)).toBe(7);
        await revokeUserSessions(selected, 7, { incrementAuthVersion: true });
      });
      const expected = driver === "mysql" ? "2026-10-19 09:25:53" : now.toISOString();
      expect(calls[0]?.params[0]).toBe(expected);
      expect(calls[0]?.params[3]).toBe(expected);
      const revoked = calls.find((call) => call.query.includes("session_valid_after"));
      expect(revoked?.query).toContain("auth_version = auth_version + 1");
      expect(revoked?.params[1]).toBe(7);
      expect(revoked?.params[0]).toMatch(
        driver === "mysql" ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ : /^\d{4}-.*Z$/,
      );
    });
  }

  test("consumeOneTimeToken returns null for an empty token", async () => {
    const sql = {
      async unsafe<T>(): Promise<T[]> {
        return [{ user_id: 1 }] as T[];
      },
    };
    await withSql("pgsql", sql, async (selected) => {
      expect(
        await consumeOneTimeToken(selected, AUTH_ONE_TIME_PURPOSES.passwordReset, "   "),
      ).toBeNull();
    });
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
    await withSql("pgsql", sql, async (selected) => {
      expect(
        await consumeOneTimeToken(selected, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
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
    await withSql("pgsql", sql, async (selected) => {
      expect(
        await consumeOneTimeToken(selected, AUTH_ONE_TIME_PURPOSES.emailVerify, issued.plain),
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
    await withSql("mysql", sql, async (selected) => {
      expect(
        await consumeOneTimeToken(selected, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
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
    await withSql("mysql", sql, async (selected) => {
      expect(
        await consumeOneTimeToken(selected, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
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
    await withSql("mysql", sql, async (selected) => {
      expect(
        await consumeOneTimeToken(selected, AUTH_ONE_TIME_PURPOSES.passwordReset, issued.plain),
      ).toBeNull();
    });
  });

  test("revokeUserSessions updates the watermark and deletes sessions and tokens", async () => {
    const queries: string[] = [];
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        queries.push(query);
        if (query.includes("sqlite_master")) return [{ relation: "present" }] as T[];
        return [] as T[];
      },
    };
    await withSql("sqlite", sql, (selected) => revokeUserSessions(selected, 3));
    expect(queries[0]).toContain("session_valid_after");
    expect(queries[0]).not.toContain("auth_version");
    expect(queries.filter((query) => query.startsWith("DELETE"))).toEqual([
      "DELETE FROM sessions WHERE user_id = ?",
      "DELETE FROM api_tokens WHERE user_id = ?",
    ]);
  });

  test("revokeUserSessions can keep api tokens", async () => {
    const queries: string[] = [];
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        queries.push(query);
        if (query.includes("sqlite_master")) return [{ relation: "present" }] as T[];
        return [] as T[];
      },
    };
    await withSql("sqlite", sql, (selected) =>
      revokeUserSessions(selected, 3, { revokeApiTokens: false }),
    );
    expect(queries.some((query) => query.includes("DELETE FROM api_tokens"))).toBe(false);
  });

  test("revokeUserSessions omits a missing sessions table before attempting deletion", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("DELETE FROM sessions")) {
          throw new Error("no such table: sessions");
        }
        return [] as T[];
      },
    };
    await expect(
      withSql("sqlite", sql, (selected) => revokeUserSessions(selected, 8)),
    ).resolves.toBeUndefined();
  });

  test("revokeUserSessions rethrows a real delete error", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("sqlite_master")) return [{ relation: "sessions" }] as T[];
        if (query.includes("DELETE FROM sessions")) {
          throw new Error("connection reset");
        }
        return [] as T[];
      },
    };
    await expect(
      withSql("sqlite", sql, (selected) => revokeUserSessions(selected, 8)),
    ).rejects.toMatchObject({
      code: "DATABASE_OPERATION_FAILED",
      cause: expect.objectContaining({ message: "connection reset" }),
    });
  });

  test("revokeUserSessions omits a missing api_tokens table before attempting deletion", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("DELETE FROM api_tokens")) {
          throw new Error("ER_NO_SUCH_TABLE");
        }
        return [] as T[];
      },
    };
    await expect(
      withSql("sqlite", sql, (selected) => revokeUserSessions(selected, 8)),
    ).resolves.toBeUndefined();
  });

  test("revokeUserSessions rethrows a real api token delete error", async () => {
    const sql = {
      async unsafe<T>(query: string): Promise<T[]> {
        if (query.includes("sqlite_master")) return [{ relation: "api_tokens" }] as T[];
        if (query.includes("DELETE FROM api_tokens")) {
          throw new Error("deadlock");
        }
        return [] as T[];
      },
    };
    await expect(
      withSql("sqlite", sql, (selected) => revokeUserSessions(selected, 8)),
    ).rejects.toMatchObject({
      code: "DATABASE_OPERATION_FAILED",
      cause: expect.objectContaining({ message: "deadlock" }),
    });
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
    await expect(
      withSql("pgsql", sql, (selected) => revokeUserSessions(selected, 8)),
    ).rejects.toMatchObject({
      code: "DATABASE_OPERATION_FAILED",
      cause: expect.objectContaining({ message: "relation does not exist" }),
    });
    expect(queries.some((query) => query.includes("to_regclass"))).toBe(true);
  });
});

for (const code of ["ER_NO_SUCH_TABLE", "ER_LOCK_WAIT_TIMEOUT"]) {
  test(`MySQL protocol unit: present optional-table DELETE preserves native ${code} cause and fails closed`, async () => {
    // SQL-shape protocol fixture only; no claim of native MySQL commit or rollback evidence.
    const native = Object.assign(new Error("credential deletion protocol failure"), { code });
    const queries: string[] = [];
    const result = await withSql(
      "mysql",
      {
        async unsafe<T>(query: string): Promise<T[]> {
          queries.push(query);
          if (query.includes("information_schema.tables")) return [{ relation: "sessions" }] as T[];
          if (query.startsWith("DELETE FROM sessions")) throw native;
          return [];
        },
      },
      (selected) => revokeUserSessions(selected, 8),
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Credential failure was swallowed");
    expect(result.error).toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
    expect((result.error as Error).cause).toBe(native);
    expect(queries.some((query) => query.startsWith("UPDATE users"))).toBe(true);
    expect(queries.filter((query) => query.startsWith("DELETE"))).toEqual([
      "DELETE FROM sessions WHERE user_id = ?",
    ]);
    expect(queries.some((query) => query.includes("api_tokens"))).toBe(false);
  });
}

test("optional storage metadata absence suppresses DELETE without suppressing user revocation", async () => {
  const queries: string[] = [];
  await withSql(
    "mysql",
    {
      async unsafe<T>(query: string): Promise<T[]> {
        queries.push(query);
        return [];
      },
    },
    (selected) => revokeUserSessions(selected, 8),
  );
  expect(queries[0]).toContain("UPDATE users SET session_valid_after");
  expect(queries.filter((query) => query.includes("information_schema.tables"))).toHaveLength(2);
  expect(queries.some((query) => query.startsWith("DELETE"))).toBe(false);
});
