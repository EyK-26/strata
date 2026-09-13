import {
  BadRequestError,
  ConflictError,
  type HttpError,
  InternalServerError,
  toHttpError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";

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
  if (typeof error.errno === "string" && /^\d{5}$/.test(error.errno)) {
    return error.errno;
  }

  if (typeof error.errno === "number") {
    return String(error.errno).padStart(5, "0");
  }

  if (typeof error.code === "string" && /^\d{5}$/.test(error.code)) {
    return error.code;
  }

  return undefined;
}

const MYSQL_ERRNO_MESSAGES: Record<number, () => HttpError> = {
  1062: () => new ConflictError("A record with these values already exists."),
  1451: () => new UnprocessableEntityError("Record is still referenced by other records."),
  1452: () => new UnprocessableEntityError("Referenced record does not exist."),
  1048: () => new BadRequestError("Required field is missing."),
  3819: () => new BadRequestError("Value violates a database constraint."),
};

function mapSqliteError(error: PostgresErrorLike): HttpError | null {
  const code = typeof error.code === "string" ? error.code : "";
  if (!code.startsWith("SQLITE_")) {
    return null;
  }
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return new ConflictError("A record with these values already exists.");
  }
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return new UnprocessableEntityError("Referenced record does not exist.");
  }
  if (code === "SQLITE_CONSTRAINT_NOTNULL") {
    return new BadRequestError("Required field is missing.");
  }
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return new BadRequestError("Value violates a database constraint.");
  }
  return new InternalServerError("Database operation failed.");
}

function mapMysqlError(error: PostgresErrorLike): HttpError | null {
  const code = typeof error.code === "string" ? error.code : "";
  if (!code.startsWith("ER_")) {
    return null;
  }
  const factory = typeof error.errno === "number" ? MYSQL_ERRNO_MESSAGES[error.errno] : undefined;
  return factory ? factory() : new InternalServerError("Database operation failed.");
}

/**
 * Constraint violations become 4xx with a fixed message. Anything else is a
 * 500 with a generic message; the raw driver text never reaches the client.
 */
function mapDatabaseError(error: unknown): HttpError {
  const httpError = toHttpError(error);

  if (httpError) {
    return httpError;
  }

  if (!isPostgresError(error)) {
    return new InternalServerError();
  }

  const sqlite = mapSqliteError(error);
  if (sqlite) {
    return sqlite;
  }

  const mysql = mapMysqlError(error);
  if (mysql) {
    return mysql;
  }

  const sqlState = getPostgresSqlState(error);

  switch (sqlState) {
    case "23505":
      if (error.detail) {
        console.error("[database] unique violation", error.detail);
      }
      return new ConflictError("A record with these values already exists.");
    case "23503":
      if (error.detail) {
        console.error("[database] foreign-key violation", error.detail);
      }
      return new UnprocessableEntityError("Referenced record does not exist.");
    case "23502":
      if (error.detail) {
        console.error("[database] not-null violation", error.detail);
      }
      return new BadRequestError("Required field is missing.");
    case "23514":
      if (error.detail) {
        console.error("[database] check violation", error.detail);
      }
      return new BadRequestError("Value violates a database constraint.");
    default:
      return new InternalServerError("Database operation failed.");
  }
}

async function withDatabaseErrorHandling<TValue>(
  operation: () => Promise<TValue>,
): Promise<TValue> {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!isPostgresError(error)) {
    return false;
  }

  if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return true;
  }

  if (error.errno === 1062) {
    return true;
  }

  return getPostgresSqlState(error) === "23505";
}

export { isPostgresError, isUniqueConstraintError, mapDatabaseError, withDatabaseErrorHandling };
