/** A requested record does not exist, independent of its transport. */
class RecordNotFoundError extends Error {
  constructor(message = "Record not found.") {
    super(message);
    this.name = new.target.name;
  }
}

/** Neutral persistence failures. Transport adapters choose response status and shape. */
const PERSISTENCE_MESSAGES = {
  DATABASE_CONFIG_INVALID: "Database configuration is invalid.",
  DATABASE_CONNECTION_UNKNOWN: "Database connection is not configured.",
  DATABASE_TRANSACTION_SCOPE: "Database transaction scope is not active.",
  DATABASE_UNSUPPORTED_CAPABILITY: "Database capability is not supported.",
  DATABASE_TRANSACTION_ROLLBACK_ONLY: "Transaction rolled back after a failed database operation.",
  DATABASE_TRANSACTION_FAILED: "Database transaction failed.",
  DATABASE_TRANSACTION_UNKNOWN: "Database transaction outcome is unknown.",
  DATABASE_POST_COMMIT_FAILED: "Database work failed after commit.",
  DATABASE_UNIQUE_CONSTRAINT: "A record with these values already exists.",
  DATABASE_FOREIGN_KEY_CONSTRAINT: "Referenced record does not exist.",
  DATABASE_REFERENCED_RECORD: "Record is still referenced by other records.",
  DATABASE_RELATED_RECORD_CONSTRAINT: "Operation conflicts with related records.",
  DATABASE_NOT_NULL_CONSTRAINT: "Required field is missing.",
  DATABASE_CHECK_CONSTRAINT: "Value violates a database constraint.",
  DATABASE_OPERATION_FAILED: "Database operation failed.",
} as const;

type PersistenceErrorCode = keyof typeof PERSISTENCE_MESSAGES;
type TransactionDataDisposition = "not-started" | "committed" | "rolled-back" | "unknown";
type PersistenceResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; error: unknown }>;
interface PersistenceErrorOptions {
  readonly cause?: unknown;
  readonly data?: TransactionDataDisposition;
  readonly result?: PersistenceResult;
}

class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  declare readonly data?: TransactionDataDisposition;
  declare readonly result?: PersistenceResult;

  constructor(code: PersistenceErrorCode, options: PersistenceErrorOptions = {}) {
    if (!Object.hasOwn(PERSISTENCE_MESSAGES, code))
      throw new TypeError("Unknown persistence error code.");
    super(
      PERSISTENCE_MESSAGES[code],
      Object.hasOwn(options, "cause") ? { cause: options.cause } : undefined,
    );
    this.name = "PersistenceError";
    this.code = code;
    const data = options.data;
    if (data !== undefined) {
      if (!["not-started", "committed", "rolled-back", "unknown"].includes(data))
        throw new TypeError("Invalid transaction data disposition.");
      Object.defineProperty(this, "data", { value: data, enumerable: true });
    }
    const result = options.result;
    if (result !== undefined) {
      if (
        result === null ||
        typeof result !== "object" ||
        (Object.getPrototypeOf(result) !== Object.prototype &&
          Object.getPrototypeOf(result) !== null)
      )
        throw new TypeError("Invalid persistence result observation.");
      const ok = Object.getOwnPropertyDescriptor(result, "ok");
      if (!ok || !("value" in ok) || typeof ok.value !== "boolean")
        throw new TypeError("Invalid persistence result observation.");
      const payload = Object.getOwnPropertyDescriptor(result, ok.value ? "value" : "error");
      if (!payload || !("value" in payload))
        throw new TypeError("Invalid persistence result observation.");
      Object.defineProperty(this, "result", {
        value: Object.freeze(
          ok.value ? { ok: true, value: payload.value } : { ok: false, error: payload.value },
        ),
        enumerable: false,
      });
    }
  }
}

interface PostgresErrorLike {
  code?: string;
  errno?: string | number;
  constraint?: string;
  detail?: string;
  message?: string;
}

function isPostgresError(error: unknown): error is PostgresErrorLike {
  return typeof error === "object" && error !== null && ("errno" in error || "code" in error);
}

function getPostgresSqlState(error: PostgresErrorLike): string | undefined {
  if (typeof error.errno === "string" && /^\d{5}$/.test(error.errno)) return error.errno;
  if (
    typeof error.errno === "number" &&
    Number.isInteger(error.errno) &&
    error.errno >= 10000 &&
    error.errno <= 99999
  )
    return String(error.errno);
  if (typeof error.code === "string" && /^\d{5}$/.test(error.code)) return error.code;
  return undefined;
}

function driverErrorCode(error: PostgresErrorLike): PersistenceErrorCode {
  const code = typeof error.code === "string" ? error.code : "";
  if (code.startsWith("SQLITE_")) {
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY")
      return "DATABASE_UNIQUE_CONSTRAINT";
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return "DATABASE_RELATED_RECORD_CONSTRAINT";
    if (code === "SQLITE_CONSTRAINT_NOTNULL") return "DATABASE_NOT_NULL_CONSTRAINT";
    if (code.startsWith("SQLITE_CONSTRAINT")) return "DATABASE_CHECK_CONSTRAINT";
    return "DATABASE_OPERATION_FAILED";
  }
  if (code.startsWith("ER_")) {
    switch (error.errno) {
      case 1062:
        return "DATABASE_UNIQUE_CONSTRAINT";
      case 1451:
        return "DATABASE_REFERENCED_RECORD";
      case 1452:
        return "DATABASE_FOREIGN_KEY_CONSTRAINT";
      case 1048:
        return "DATABASE_NOT_NULL_CONSTRAINT";
      case 3819:
        return "DATABASE_CHECK_CONSTRAINT";
      default:
        return "DATABASE_OPERATION_FAILED";
    }
  }
  switch (getPostgresSqlState(error)) {
    case "23505":
      return "DATABASE_UNIQUE_CONSTRAINT";
    case "23503":
      return "DATABASE_RELATED_RECORD_CONSTRAINT";
    case "23502":
      return "DATABASE_NOT_NULL_CONSTRAINT";
    case "23514":
      return "DATABASE_CHECK_CONSTRAINT";
    default:
      return "DATABASE_OPERATION_FAILED";
  }
}

/** Classify an actual database boundary; raw details remain an opaque, hidden cause. */
function mapDatabaseError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  return new PersistenceError(
    isPostgresError(error) ? driverErrorCode(error) : "DATABASE_OPERATION_FAILED",
    { cause: error },
  );
}

function isNativeDatabaseError(error: unknown): error is PostgresErrorLike {
  if (!isPostgresError(error)) return false;
  const code = typeof error.code === "string" ? error.code : "";
  return (
    code.startsWith("SQLITE_") ||
    code.startsWith("ER_") ||
    code === "ERR_POSTGRES_SERVER_ERROR" ||
    /^\d{5}$/.test(code) ||
    (code === "" && getPostgresSqlState(error) !== undefined)
  );
}

/** Generic operation wrappers preserve unrelated domain errors without knowing HTTP. */
async function withDatabaseErrorHandling<TValue>(
  operation: () => Promise<TValue>,
): Promise<TValue> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PersistenceError || isNativeDatabaseError(error))
      throw mapDatabaseError(error);
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof PersistenceError) return error.code === "DATABASE_UNIQUE_CONSTRAINT";
  if (!isPostgresError(error)) return false;
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY")
    return true;
  if (error.errno === 1062) return true;
  return getPostgresSqlState(error) === "23505";
}

export type {
  PersistenceErrorCode,
  PersistenceErrorOptions,
  PersistenceResult,
  TransactionDataDisposition,
};
export {
  isPostgresError,
  isUniqueConstraintError,
  mapDatabaseError,
  PersistenceError,
  RecordNotFoundError,
  withDatabaseErrorHandling,
};
