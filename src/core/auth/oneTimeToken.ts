import { randomBytes } from "node:crypto";
import { currentSqlDialect } from "../database/dialect";
import { hashApiToken } from "./tokenHash";

const AUTH_ONE_TIME_PURPOSES = {
  passwordReset: "password_reset",
  emailVerify: "email_verify",
} as const;

type AuthOneTimePurpose = (typeof AUTH_ONE_TIME_PURPOSES)[keyof typeof AUTH_ONE_TIME_PURPOSES];

function generateOneTimeToken(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString("hex");
  return { plain, hash: hashApiToken(plain) };
}

function hashOneTimeToken(plain: string): string {
  return hashApiToken(plain.trim());
}

type SqlClient = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
};

function isMissingRelation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && error.code === "ER_NO_SUCH_TABLE")
    return true;
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|does not exist|unknown table|er_no_such_table/i.test(message);
}

async function consumeOneTimeToken(
  sql: SqlClient,
  purpose: string,
  plain: string,
  now = new Date(),
): Promise<number | null> {
  const token = plain.trim();
  if (!token) {
    return null;
  }

  const dialect = currentSqlDialect();
  const consumedAt = dialect.timestampValue(now);
  const hash = hashOneTimeToken(token);
  const returning = dialect.returningClause("user_id");
  const updated = await sql.unsafe<Record<string, unknown>>(
    `UPDATE auth_one_time_tokens
     SET consumed_at = ${dialect.placeholder(1)}
     WHERE purpose = ${dialect.placeholder(2)}
       AND token_hash = ${dialect.placeholder(3)}
       AND consumed_at IS NULL
       AND expires_at > ${dialect.placeholder(4)}${returning}`,
    [consumedAt, purpose, hash, consumedAt],
  );

  if (returning) {
    const userId = updated[0]?.user_id;
    return userId == null ? null : Number(userId);
  }

  const header = updated[0];
  const affected = Number(header?.affectedRows ?? header?.changes ?? 0);
  if (affected !== 1) {
    return null;
  }

  const rows = await sql.unsafe<{ user_id: number }>(
    `SELECT user_id FROM auth_one_time_tokens
     WHERE purpose = ${dialect.placeholder(1)} AND token_hash = ${dialect.placeholder(2)}`,
    [purpose, hash],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

async function revokeUserSessions(
  sql: SqlClient,
  userId: number,
  options: {
    revokeApiTokens?: boolean;
    /** Requires the account-state migration. Call within the account mutation transaction. */
    incrementAuthVersion?: boolean;
  } = {},
): Promise<void> {
  const dialect = currentSqlDialect();
  const versionUpdate = options.incrementAuthVersion ? ", auth_version = auth_version + 1" : "";
  await sql.unsafe(
    `UPDATE users SET session_valid_after = ${dialect.placeholder(1)}${versionUpdate} WHERE id = ${dialect.placeholder(2)}`,
    [dialect.timestampValue(new Date()), userId],
  );

  await deleteOptionalCredentials(sql, "sessions", userId);
  if (options.revokeApiTokens !== false) {
    await deleteOptionalCredentials(sql, "api_tokens", userId);
  }
}

async function deleteOptionalCredentials(
  sql: SqlClient,
  table: "sessions" | "api_tokens",
  userId: number,
): Promise<void> {
  const dialect = currentSqlDialect();
  if (dialect.driver === "pgsql") {
    // Catching undefined_table does not restore an aborted Postgres transaction.
    // Resolve optional storage without issuing a failing statement in that transaction.
    const [row] = await sql.unsafe<{ relation: string | null }>(
      `SELECT to_regclass(${dialect.placeholder(1)}) AS relation`,
      [table],
    );
    if (row?.relation == null) return;
  }
  try {
    await sql.unsafe(`DELETE FROM ${table} WHERE user_id = ${dialect.placeholder(1)}`, [userId]);
  } catch (error) {
    // A concurrent Postgres DDL change must fail the caller's transaction, not
    // pretend that the watermark/epoch and credential deletion committed.
    if (dialect.driver === "pgsql" || !isMissingRelation(error)) throw error;
  }
}

export type { AuthOneTimePurpose };
export {
  AUTH_ONE_TIME_PURPOSES,
  consumeOneTimeToken,
  generateOneTimeToken,
  hashOneTimeToken,
  revokeUserSessions,
};
