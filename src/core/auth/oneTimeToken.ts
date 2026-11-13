import { randomBytes } from "node:crypto";
import type { DatabaseSession, TransactionSession } from "../database/session";
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

type SqlClient = DatabaseSession | TransactionSession;
function executeRows<R>(
  sql: SqlClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<readonly R[]> {
  return sql.execute<R>({ text, params });
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

  const dialect = sql.dialect;
  const consumedAt = dialect.timestampValue(now);
  const hash = hashOneTimeToken(token);
  const returning = dialect.returningClause("user_id");
  const updated = await executeRows<Record<string, unknown>>(
    sql,
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

  const rows = await executeRows<{ user_id: number }>(
    sql,
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
  const dialect = sql.dialect;
  const versionUpdate = options.incrementAuthVersion ? ", auth_version = auth_version + 1" : "";
  await executeRows(
    sql,
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
  const dialect = sql.dialect;
  if (dialect.driver === "pgsql") {
    // Catching undefined_table does not restore an aborted Postgres transaction.
    // Resolve optional storage without issuing a failing statement in that transaction.
    const [row] = await executeRows<{ relation: string | null }>(
      sql,
      `SELECT to_regclass(${dialect.placeholder(1)}) AS relation`,
      [table],
    );
    if (row?.relation == null) return;
  }
  if (dialect.driver !== "pgsql") {
    const [row] = await executeRows<{ relation: string }>(
      sql,
      dialect.driver === "sqlite"
        ? `SELECT name AS relation FROM sqlite_master WHERE type = 'table' AND name = ${dialect.placeholder(1)}`
        : `SELECT TABLE_NAME AS relation FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${dialect.placeholder(1)}`,
      [table],
    );
    if (!row) return;
  }
  // Concurrent DDL or credential deletion failure must fail the caller on every driver.
  // Canonical sessions preserve the native error as the opaque PersistenceError cause.
  await executeRows(sql, `DELETE FROM ${table} WHERE user_id = ${dialect.placeholder(1)}`, [
    userId,
  ]);
}

export type { AuthOneTimePurpose };
export {
  AUTH_ONE_TIME_PURPOSES,
  consumeOneTimeToken,
  generateOneTimeToken,
  hashOneTimeToken,
  revokeUserSessions,
};
