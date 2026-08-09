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

  test("maps non-postgres errors to bad request errors", () => {
    expect(mapDatabaseError(new Error("boom")).status).toBe(400);
    expect(mapDatabaseError(new Error("boom")).message).toBe("boom");
    expect(mapDatabaseError("plain failure").message).toBe("Database operation failed.");
    expect(mapDatabaseError(null).message).toBe("Database operation failed.");
    expect(mapDatabaseError(123).message).toBe("Database operation failed.");
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

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toBe("Unexpected database failure.");
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

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toBe("generic failure");
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

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toBe("generic failure");
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
