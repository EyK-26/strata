import {
  isPostgresError,
  mapDatabaseError,
  PersistenceError,
} from "@getstrata/core/database/errors";
import {
  BadRequestError,
  ConflictError,
  type HttpError,
  InternalServerError,
  toHttpError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";

/** Transport-only status mapping; persistence never imports response classes. */
function mapDatabaseHttpError(error: unknown): HttpError {
  const existing = toHttpError(error);
  if (existing) return existing;
  if (!(error instanceof PersistenceError) && !isPostgresError(error))
    return new InternalServerError();
  const outer = mapDatabaseError(error);
  let failure = outer;
  if (
    (outer.code === "DATABASE_TRANSACTION_UNKNOWN" ||
      outer.code === "DATABASE_TRANSACTION_FAILED") &&
    outer.data !== "committed"
  ) {
    const cause = Object.getOwnPropertyDescriptor(outer, "cause")?.value;
    // A single native constraint can determine an HTTP status without determining
    // transaction durability. Never traverse unrelated causes or cleanup aggregates.
    if (
      !(cause instanceof AggregateError) &&
      (cause instanceof PersistenceError || isPostgresError(cause))
    ) {
      const direct = mapDatabaseError(cause);
      if (
        [
          "DATABASE_UNIQUE_CONSTRAINT",
          "DATABASE_FOREIGN_KEY_CONSTRAINT",
          "DATABASE_REFERENCED_RECORD",
          "DATABASE_RELATED_RECORD_CONSTRAINT",
          "DATABASE_NOT_NULL_CONSTRAINT",
          "DATABASE_CHECK_CONSTRAINT",
        ].includes(direct.code)
      )
        failure = direct;
    }
  }
  switch (failure.code) {
    case "DATABASE_UNIQUE_CONSTRAINT":
    case "DATABASE_TRANSACTION_ROLLBACK_ONLY":
      return new ConflictError(failure.message);
    case "DATABASE_FOREIGN_KEY_CONSTRAINT":
    case "DATABASE_REFERENCED_RECORD":
    case "DATABASE_RELATED_RECORD_CONSTRAINT":
      return new UnprocessableEntityError(failure.message);
    case "DATABASE_NOT_NULL_CONSTRAINT":
    case "DATABASE_CHECK_CONSTRAINT":
      return new BadRequestError(failure.message);
    default:
      return new InternalServerError(failure.message);
  }
}

export { mapDatabaseHttpError };
