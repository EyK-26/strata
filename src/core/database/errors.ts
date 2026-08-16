import {
  BadRequestError,
  ConflictError,
  HttpError,
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

function mapDatabaseError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (!isPostgresError(error)) {
    const message = error instanceof Error ? error.message : "Database operation failed.";
    return new BadRequestError(message);
  }

  const sqlState = getPostgresSqlState(error);

  switch (sqlState) {
    case "23505":
      return new ConflictError(error.detail ?? "A record with these values already exists.", {
        constraint: error.constraint,
      });
    case "23503":
      return new UnprocessableEntityError(error.detail ?? "Referenced record does not exist.", {
        constraint: error.constraint,
      });
    case "23502":
      return new BadRequestError(error.detail ?? "Required field is missing.", {
        constraint: error.constraint,
      });
    case "23514":
      return new BadRequestError(error.detail ?? "Value violates a database constraint.", {
        constraint: error.constraint,
      });
    default:
      return new BadRequestError(error.message ?? "Database operation failed.", {
        code: error.code,
        sqlState,
      });
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

export { isPostgresError, mapDatabaseError, withDatabaseErrorHandling };
