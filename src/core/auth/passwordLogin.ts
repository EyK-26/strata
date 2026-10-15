import type { AuthUserRecord } from "../contracts/authUserDirectory";
import { revealMfaSecret } from "../crypto/mfaSecret";
import { currentSqlDialect } from "../database/dialect";
import { UnprocessableEntityError } from "../errors/http";
import { recoveryCodeMatches } from "../security/recoveryCodes";
import { verifyTotp } from "../security/totp";

type PasswordLoginFailure = "mfa_required" | "mfa_invalid";

type PasswordLoginSuccess = {
  ok: true;
  consumedRecoveryHash?: string;
};

type PasswordLoginDenied = {
  ok: false;
  error: PasswordLoginFailure;
};

type PasswordLoginResult = PasswordLoginSuccess | PasswordLoginDenied;

function parseRecoveryHashes(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function completePasswordLogin(
  user: Pick<AuthUserRecord, "mfa_enabled" | "mfa_secret" | "mfa_recovery_codes">,
  options: { mfaCode?: string | null } = {},
): PasswordLoginResult {
  if (!user.mfa_enabled) {
    return { ok: true };
  }

  const submitted = options.mfaCode?.trim() ?? "";
  if (!submitted) {
    return { ok: false, error: "mfa_required" };
  }

  const secret = revealMfaSecret(user.mfa_secret);
  if (secret && verifyTotp(secret, submitted)) {
    return { ok: true };
  }

  const hashes = parseRecoveryHashes(user.mfa_recovery_codes);
  const matched = hashes.find((hash) => recoveryCodeMatches(submitted, hash));
  if (matched) {
    return { ok: true, consumedRecoveryHash: matched };
  }

  return { ok: false, error: "mfa_invalid" };
}

async function persistConsumedRecoveryHash(
  sql: { unsafe(query: string, params?: readonly unknown[]): Promise<unknown[]> },
  userId: number,
  currentRaw: string | null | undefined,
  consumedHash: string | undefined,
): Promise<void> {
  if (!consumedHash) {
    return;
  }

  const hashes = parseRecoveryHashes(currentRaw);
  if (typeof currentRaw !== "string" || !hashes.includes(consumedHash)) {
    throw new UnprocessableEntityError("mfa_invalid");
  }
  const dialect = currentSqlDialect();
  const returning = dialect.returningClause("id");
  const rows = await sql.unsafe(
    `UPDATE users SET mfa_recovery_codes = ${dialect.placeholder(1)} WHERE id = ${dialect.placeholder(2)} AND mfa_recovery_codes = ${dialect.placeholder(3)}${returning}`,
    [JSON.stringify(hashes.filter((hash) => hash !== consumedHash)), userId, currentRaw],
  );
  const header = rows[0];
  const affected = returning
    ? rows.length
    : typeof header === "object" && header !== null && "affectedRows" in header
      ? Number(header.affectedRows)
      : 0;
  if (affected !== 1) throw new UnprocessableEntityError("mfa_invalid");
}

export type { PasswordLoginResult };
export { completePasswordLogin, parseRecoveryHashes, persistConsumedRecoveryHash };
