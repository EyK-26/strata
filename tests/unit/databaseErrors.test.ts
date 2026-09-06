import { describe, expect, test } from "bun:test";
import {
  isPostgresError,
  mapDatabaseError,
  withDatabaseErrorHandling,
} from "@getstrata/core/database/errors";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";

describe("isPostgresError", () => {
  test("detects postgres-like error objects", () => {
    expect(isPostgresError({ errno: "23505" })).toBe(true);
    expect(isPostgresError({ code: "23503" })).toBe(true);
    expect(isPostgresError(new Error("nope"))).toBe(false);
  });
});

describe("mapDatabaseError", () => {
  test("returns existing http errors unchanged", () => {
    const original = new BadRequestError("already mapped");

    expect(mapDatabaseError(original)).toBe(original);
  });

  test("keeps ForbiddenError as 403 even when instanceof HttpError fails", () => {
    const fromPublicEntry = new ForbiddenError();
    const mappedFromPublic = mapDatabaseError(fromPublicEntry);

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
    const mappedForeign = mapDatabaseError(foreign);

    expect(foreign instanceof HttpError).toBe(false);
    expect(mappedForeign.status).toBe(403);
    expect(mappedForeign.message).toBe("Forbidden");
  });

  test("maps unknown errors to a generic 500 without leaking the message", () => {
    expect(mapDatabaseError(new Error("boom")).status).toBe(500);
    expect(mapDatabaseError(new Error("boom")).message).toBe("Internal server error.");
    expect(mapDatabaseError("plain failure").status).toBe(500);
    expect(mapDatabaseError(null).message).toBe("Internal server error.");
    expect(mapDatabaseError(123).message).toBe("Internal server error.");
  });

  test("maps SQLite constraint codes to 4xx and other SQLite errors to 500", () => {
    const unique = mapDatabaseError({
      code: "SQLITE_CONSTRAINT_UNIQUE",
      errno: 2067,
      message: "UNIQUE constraint failed: users.email",
    });
    expect(unique).toBeInstanceOf(ConflictError);
    expect(unique.message).not.toContain("users.email");
    expect(mapDatabaseError({ code: "SQLITE_CONSTRAINT_PRIMARYKEY", errno: 1555 }).status).toBe(
      409,
    );
    expect(mapDatabaseError({ code: "SQLITE_CONSTRAINT_FOREIGNKEY", errno: 787 }).status).toBe(422);
    expect(mapDatabaseError({ code: "SQLITE_CONSTRAINT_NOTNULL", errno: 1299 }).status).toBe(400);
    expect(mapDatabaseError({ code: "SQLITE_CONSTRAINT_CHECK", errno: 275 }).status).toBe(400);
    const busy = mapDatabaseError({ code: "SQLITE_BUSY", errno: 5, message: "database is locked" });
    expect(busy.status).toBe(500);
    expect(busy.message).toBe("Database operation failed.");
  });

  test("maps MySQL errno values to 4xx and other MySQL errors to 500", () => {
    const dup = mapDatabaseError({
      code: "ER_DUP_ENTRY",
      errno: 1062,
      message: "Duplicate entry 'demo@example.com' for key 'users.email'",
    });
    expect(dup).toBeInstanceOf(ConflictError);
    expect(dup.message).not.toContain("demo@example.com");
    expect(mapDatabaseError({ code: "ER_NO_REFERENCED_ROW_2", errno: 1452 }).status).toBe(422);
    expect(mapDatabaseError({ code: "ER_ROW_IS_REFERENCED_2", errno: 1451 }).status).toBe(422);
    expect(mapDatabaseError({ code: "ER_BAD_NULL_ERROR", errno: 1048 }).status).toBe(400);
    expect(mapDatabaseError({ code: "ER_CHECK_CONSTRAINT_VIOLATED", errno: 3819 }).status).toBe(
      400,
    );
    const syntax = mapDatabaseError({
      code: "ER_PARSE_ERROR",
      errno: 1064,
      message: "You have an error in your SQL syntax near 'SELEC'",
    });
    expect(syntax.status).toBe(500);
    expect(syntax.message).toBe("Database operation failed.");
  });

  test("maps postgres unique violations to conflict errors", () => {
    const error = mapDatabaseError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23505",
      detail: "Key (slug)=(acme) already exists.",
      constraint: "organization_slug_key",
    });

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain("already exists");
  });

  test("maps postgres foreign key violations to unprocessable entity errors", () => {
    const error = mapDatabaseError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23503",
      detail: 'Key (organization_id)=(999) is not present in table "organization".',
    });

    expect(error).toBeInstanceOf(UnprocessableEntityError);
  });

  test("maps postgres not-null violations to bad request errors", () => {
    const error = mapDatabaseError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23502",
      detail: 'null value in column "name" violates not-null constraint',
    });

    expect(error).toBeInstanceOf(BadRequestError);
  });

  test("maps check constraint violations to bad request errors", () => {
    const error = mapDatabaseError({
      errno: "23514",
      detail: "Value violates a database constraint.",
      constraint: "task_priority_check",
    });

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toContain("database constraint");
  });

  test("maps unknown postgres sql states with fallback metadata", () => {
    const error = mapDatabaseError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: 99999,
      message: "Unexpected database failure.",
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe("Database operation failed.");
  });

  test("reads five-digit sql states from numeric errno values", () => {
    const error = mapDatabaseError({
      errno: 23505,
      detail: "duplicate",
    });

    expect(error).toBeInstanceOf(ConflictError);
  });

  test("returns undefined sql state for non-postgres codes", () => {
    const error = mapDatabaseError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      message: "generic failure",
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe("Database operation failed.");
  });

  test("reads five-digit sql states from string code values", () => {
    const error = mapDatabaseError({
      code: "23503",
      detail: "missing parent",
    });

    expect(error).toBeInstanceOf(UnprocessableEntityError);
  });

  test("ignores non-five-digit errno and code values", () => {
    const error = mapDatabaseError({
      errno: "ERR",
      code: "ERR_POSTGRES",
      message: "generic failure",
    });

    expect(error.status).toBe(500);
    expect(error.message).toBe("Database operation failed.");
  });

  test("uses default postgres error messages when detail is missing", () => {
    expect(mapDatabaseError({ errno: "23505" }).message).toContain("already exists");
    expect(mapDatabaseError({ errno: "23503" }).message).toContain("Referenced record");
    expect(mapDatabaseError({ errno: "23502" }).message).toContain("Required field");
    expect(mapDatabaseError({ errno: "23514" }).message).toContain("database constraint");
    expect(mapDatabaseError({ errno: "99999", message: undefined }).message).toBe(
      "Database operation failed.",
    );
  });
});

describe("withDatabaseErrorHandling", () => {
  test("returns successful operation results", async () => {
    await expect(withDatabaseErrorHandling(async () => "ok")).resolves.toBe("ok");
  });

  test("maps thrown database errors", async () => {
    await expect(
      withDatabaseErrorHandling(async () => {
        throw { errno: "23505", detail: "duplicate" };
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("rethrows mapped http errors from operations", async () => {
    await expect(
      withDatabaseErrorHandling(async () => {
        throw new HttpError(418, "teapot");
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
