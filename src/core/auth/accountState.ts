import type { AuthUserRecord } from "../contracts/authUserDirectory";
import type { AuthUser } from "./authContext";

/** Absence preserves legacy directories; an explicit non-true value fails closed. */
function isAccountActive(record: Pick<AuthUserRecord, "is_active">): boolean {
  return record.is_active === undefined || record.is_active === true;
}

/** Custom/token directories must project current account state into their principal. */
function isAuthUserActive(user: AuthUser): boolean {
  return user.isActive === undefined || user.isActive === true;
}

/** Opt-in epochs fence stateless credentials independently of wall-clock precision. */
function matchesAuthVersion(issued: unknown, current: number | undefined): boolean {
  if (current === undefined) return true;
  return (
    Number.isSafeInteger(current) &&
    current >= 0 &&
    typeof issued === "number" &&
    Number.isSafeInteger(issued) &&
    issued >= 0 &&
    issued === current
  );
}

export { isAccountActive, isAuthUserActive, matchesAuthVersion };
