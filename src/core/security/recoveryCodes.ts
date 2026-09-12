import { randomBytes } from "node:crypto";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";

const DEFAULT_RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_BYTES = 16;

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function formatRecoveryCode(normalized: string): string {
  if (normalized.length !== RECOVERY_CODE_BYTES * 2) {
    return normalized;
  }

  return normalized.match(/.{1,4}/gu)?.join("-") ?? normalized;
}

function generateRecoveryCodes(count = DEFAULT_RECOVERY_CODE_COUNT): string[] {
  const size = Number.isInteger(count) && count > 0 ? count : DEFAULT_RECOVERY_CODE_COUNT;
  const codes = new Set<string>();

  while (codes.size < size) {
    codes.add(formatRecoveryCode(randomBytes(RECOVERY_CODE_BYTES).toString("hex")));
  }

  return [...codes];
}

function hashRecoveryCode(code: string): string {
  return hashApiToken(normalizeRecoveryCode(code));
}

function recoveryCodeMatches(code: string, hash: string): boolean {
  return timingSafeCompareString(hashRecoveryCode(code), hash);
}

export {
  DEFAULT_RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  recoveryCodeMatches,
};
