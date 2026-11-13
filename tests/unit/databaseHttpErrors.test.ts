import { describe, expect, test } from "bun:test";
import { PersistenceError } from "@getstrata/core/database/errors";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { mapDatabaseHttpError } from "@getstrata/core/http/databaseError";

describe("mapDatabaseHttpError", () => {
  test("returns existing http errors unchanged", () => {
    const original = new BadRequestError("already mapped");

    expect(mapDatabaseHttpError(original)).toBe(original);
  });

  test("keeps ForbiddenError as 403 even when instanceof HttpError fails", () => {
    const fromPublicEntry = new ForbiddenError();
    const mappedFromPublic = mapDatabaseHttpError(fromPublicEntry);

    expect(mappedFromPublic).toBe(fromPublicEntry);
    expect(mappedFromPublic.status).toBe(403);

    class ForeignForbidden extends Error {
      readonly status = 403;

      constructor() {
        super("Forbidden");
        this.name = "ForbiddenError";
      }
    }

    const foreign = new ForeignForbidden();
    const mappedForeign = mapDatabaseHttpError(foreign);

    expect(foreign instanceof HttpError).toBe(false);
    expect(mappedForeign.status).toBe(403);
    expect(mappedForeign.message).toBe("Forbidden");
  });

  test("maps unknown errors to a generic 500 without leaking the message", () => {
    expect(mapDatabaseHttpError(new Error("boom")).status).toBe(500);
    expect(mapDatabaseHttpError(new Error("boom")).message).toBe("Internal server error.");
    expect(mapDatabaseHttpError("plain failure").status).toBe(500);
    expect(mapDatabaseHttpError(null).message).toBe("Internal server error.");
    expect(mapDatabaseHttpError(123).message).toBe("Internal server error.");
  });

  test("maps SQLite constraint codes to 4xx and other SQLite errors to 500", () => {
    const unique = mapDatabaseHttpError({
      code: "SQLITE_CONSTRAINT_UNIQUE",
      errno: 2067,
      message: "UNIQUE constraint failed: users.email",
    });
    expect(unique).toBeInstanceOf(ConflictError);
    expect(unique.message).not.toContain("users.email");
    expect(mapDatabaseHttpError({ code: "SQLITE_CONSTRAINT_PRIMARYKEY", errno: 1555 }).status).toBe(
      409,
    );
    expect(mapDatabaseHttpError({ code: "SQLITE_CONSTRAINT_FOREIGNKEY", errno: 787 }).status).toBe(
      422,
    );
    expect(mapDatabaseHttpError({ code: "SQLITE_CONSTRAINT_NOTNULL", errno: 1299 }).status).toBe(
      400,
    );
    expect(mapDatabaseHttpError({ code: "SQLITE_CONSTRAINT_CHECK", errno: 275 }).status).toBe(400);
    const busy = mapDatabaseHttpError({
      code: "SQLITE_BUSY",
      errno: 5,
      message: "database is locked",
    });
    expect(busy.status).toBe(500);
    expect(busy.message).toBe("Database operation failed.");
  });

  test("maps MySQL errno values to 4xx and other MySQL errors to 500", () => {
    const dup = mapDatabaseHttpError({
      code: "ER_DUP_ENTRY",
      errno: 1062,
      message: "Duplicate entry 'demo@example.com' for key 'users.email'",
    });
    expect(dup).toBeInstanceOf(ConflictError);
    expect(dup.message).not.toContain("demo@example.com");
    expect(mapDatabaseHttpError({ code: "ER_NO_REFERENCED_ROW_2", errno: 1452 }).status).toBe(422);
    expect(mapDatabaseHttpError({ code: "ER_ROW_IS_REFERENCED_2", errno: 1451 }).status).toBe(422);
    expect(mapDatabaseHttpError({ code: "ER_BAD_NULL_ERROR", errno: 1048 }).status).toBe(400);
    expect(mapDatabaseHttpError({ code: "ER_CHECK_CONSTRAINT_VIOLATED", errno: 3819 }).status).toBe(
      400,
    );
    const syntax = mapDatabaseHttpError({
      code: "ER_PARSE_ERROR",
      errno: 1064,
      message: "You have an error in your SQL syntax near 'SELEC'",
    });
    expect(syntax.status).toBe(500);
    expect(syntax.message).toBe("Database operation failed.");
  });

  test("maps postgres unique violations to conflict errors", () => {
    const error = mapDatabaseHttpError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23505",
      detail: "Key (slug)=(acme) already exists.",
      constraint: "organization_slug_key",
    });

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("A record with these values already exists.");
    expect(error.message).not.toContain("acme");
    expect(error.details).toBeUndefined();
  });

  test("maps postgres foreign key violations to unprocessable entity errors", () => {
    const error = mapDatabaseHttpError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23503",
      detail: 'Key (organization_id)=(999) is not present in table "organization".',
    });

    expect(error).toBeInstanceOf(UnprocessableEntityError);
  });

  test("maps postgres not-null violations to bad request errors", () => {
    const error = mapDatabaseHttpError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23502",
      detail: 'null value in column "name" violates not-null constraint',
    });

    expect(error).toBeInstanceOf(BadRequestError);
  });

  test("maps check constraint violations to bad request errors", () => {
    const error = mapDatabaseHttpError({
      errno: "23514",
      detail: "Value violates a database constraint.",
      constraint: "task_priority_check",
    });

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toContain("database constraint");
  });

  test("maps unknown postgres sql states with fallback metadata", () => {
    const error = mapDatabaseHttpError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: 99999,
      message: "Unexpected database failure.",
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe("Database operation failed.");
  });

  test("reads five-digit sql states from numeric errno values", () => {
    const error = mapDatabaseHttpError({
      errno: 23505,
      detail: "duplicate",
    });

    expect(error).toBeInstanceOf(ConflictError);
  });

  test("returns undefined sql state for non-postgres codes", () => {
    const error = mapDatabaseHttpError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      message: "generic failure",
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe("Database operation failed.");
  });

  test("reads five-digit sql states from string code values", () => {
    const error = mapDatabaseHttpError({
      code: "23503",
      detail: "missing parent",
    });

    expect(error).toBeInstanceOf(UnprocessableEntityError);
  });

  test("ignores non-five-digit errno and code values", () => {
    const error = mapDatabaseHttpError({
      errno: "ERR",
      code: "ERR_POSTGRES",
      message: "generic failure",
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe("Database operation failed.");
  });

  test("uses default postgres error messages when detail is missing", () => {
    expect(mapDatabaseHttpError({ errno: "23505" }).message).toContain("already exists");
    expect(mapDatabaseHttpError({ errno: "23503" }).message).toBe(
      "Operation conflicts with related records.",
    );
    expect(mapDatabaseHttpError({ errno: "23502" }).message).toContain("Required field");
    expect(mapDatabaseHttpError({ errno: "23514" }).message).toContain("database constraint");
    expect(mapDatabaseHttpError({ errno: "99999", message: undefined }).message).toBe(
      "Database operation failed.",
    );
  });
});

test("ambiguous foreign-key failures never claim every failure is a missing parent", () => {
  for (const error of [
    { errno: "23503", detail: 'Key is still referenced from table "order_items".' },
    { code: "23503", detail: 'Key is not present in table "products".' },
    { code: "SQLITE_CONSTRAINT_FOREIGNKEY", errno: 787 },
  ]) {
    const mapped = mapDatabaseHttpError(error);
    expect(mapped.status).toBe(422);
    expect(mapped.message).toBe("Operation conflicts with related records.");
    expect(mapped.message).not.toContain("order_items");
    expect(mapped.message).not.toContain("products");
  }
});

test("direct terminal constraints retain safe transport status without rewriting unknown durability", () => {
  const native = { code: "23505", detail: "private record value" };
  const failure = new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", {
    cause: native,
    data: "unknown",
  });
  const mapped = mapDatabaseHttpError(failure);
  expect(mapped.status).toBe(409);
  expect(mapped.message).not.toContain("private");
  expect(failure.data).toBe("unknown");
  expect(failure.cause).toBe(native);
  expect(
    mapDatabaseHttpError(new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", { data: "unknown" }))
      .status,
  ).toBe(500);
  expect(
    mapDatabaseHttpError(
      new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", {
        data: "unknown",
        cause: new AggregateError([native], "cleanup"),
      }),
    ).status,
  ).toBe(500);
  expect(
    mapDatabaseHttpError(
      new PersistenceError("DATABASE_TRANSACTION_FAILED", {
        data: "unknown",
        cause: new Error("wrapper", { cause: native }),
      }),
    ).status,
  ).toBe(500);
  expect(
    mapDatabaseHttpError(
      new PersistenceError("DATABASE_TRANSACTION_FAILED", { data: "committed", cause: native }),
    ).status,
  ).toBe(500);
});
