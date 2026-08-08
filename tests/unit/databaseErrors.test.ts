import { describe, expect, test } from "bun:test";
import { mapDatabaseError } from "../../src/core/database/errors";
import {
  BadRequestError,
  ConflictError,
  UnprocessableEntityError,
} from "../../src/core/errors/http";

describe("mapDatabaseError", () => {
  test("maps postgres unique violations to conflict errors", () => {
    const error = mapDatabaseError({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "23505",
      detail: 'Key (slug)=(acme) already exists.',
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
});
