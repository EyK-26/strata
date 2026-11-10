import { describe, expect, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import {
  isPostgresError,
  isUniqueConstraintError,
  mapDatabaseError,
  PersistenceError,
  type PersistenceErrorCode,
  type PersistenceErrorOptions,
  withDatabaseErrorHandling,
} from "@getstrata/core/database/errors";
import { ForbiddenError, HttpError } from "@getstrata/core/errors/http";

describe("isUniqueConstraintError", () => {
  test("detects postgres, sqlite, and mysql unique failures", () => {
    expect(isUniqueConstraintError({ code: "23505" })).toBe(true);
    expect(isUniqueConstraintError({ errno: "23505" })).toBe(true);
    expect(isUniqueConstraintError({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
    expect(isUniqueConstraintError({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(true);
    expect(isUniqueConstraintError({ errno: 1062 })).toBe(true);
    expect(isUniqueConstraintError(new Error("nope"))).toBe(false);
    expect(isUniqueConstraintError(new PersistenceError("DATABASE_UNIQUE_CONSTRAINT"))).toBe(true);
    expect(isUniqueConstraintError(new PersistenceError("DATABASE_OPERATION_FAILED"))).toBe(false);
  });
});

describe("isPostgresError", () => {
  test("detects postgres-like error objects", () => {
    expect(isPostgresError({ errno: "23505" })).toBe(true);
    expect(isPostgresError({ code: "23503" })).toBe(true);
    expect(isPostgresError(new Error("nope"))).toBe(false);
  });
});

test("database boundary classifications are neutral codes with original opaque causes and no HTTP fields", () => {
  const cases: Array<[unknown, PersistenceErrorCode]> = [
    [{ code: "SQLITE_CONSTRAINT_UNIQUE", errno: 2067 }, "DATABASE_UNIQUE_CONSTRAINT"],
    [{ code: "SQLITE_CONSTRAINT_PRIMARYKEY", errno: 1555 }, "DATABASE_UNIQUE_CONSTRAINT"],
    [{ code: "SQLITE_CONSTRAINT_FOREIGNKEY", errno: 787 }, "DATABASE_RELATED_RECORD_CONSTRAINT"],
    [{ code: "SQLITE_CONSTRAINT_NOTNULL", errno: 1299 }, "DATABASE_NOT_NULL_CONSTRAINT"],
    [{ code: "SQLITE_CONSTRAINT_CHECK", errno: 275 }, "DATABASE_CHECK_CONSTRAINT"],
    [{ code: "SQLITE_BUSY", errno: 5 }, "DATABASE_OPERATION_FAILED"],
    [{ code: "ER_DUP_ENTRY", errno: 1062 }, "DATABASE_UNIQUE_CONSTRAINT"],
    [{ code: "ER_NO_REFERENCED_ROW_2", errno: 1452 }, "DATABASE_FOREIGN_KEY_CONSTRAINT"],
    [{ code: "ER_ROW_IS_REFERENCED_2", errno: 1451 }, "DATABASE_REFERENCED_RECORD"],
    [{ code: "ER_BAD_NULL_ERROR", errno: 1048 }, "DATABASE_NOT_NULL_CONSTRAINT"],
    [{ code: "ER_CHECK_CONSTRAINT_VIOLATED", errno: 3819 }, "DATABASE_CHECK_CONSTRAINT"],
    [{ code: "ER_PARSE_ERROR", errno: 1064 }, "DATABASE_OPERATION_FAILED"],
    [{ code: "ERR_POSTGRES_SERVER_ERROR", errno: "23505" }, "DATABASE_UNIQUE_CONSTRAINT"],
    [{ errno: 23505 }, "DATABASE_UNIQUE_CONSTRAINT"],
    [{ code: "23503" }, "DATABASE_RELATED_RECORD_CONSTRAINT"],
    [{ errno: "23502" }, "DATABASE_NOT_NULL_CONSTRAINT"],
    [{ errno: "23514" }, "DATABASE_CHECK_CONSTRAINT"],
    [{ errno: 99999 }, "DATABASE_OPERATION_FAILED"],
    [undefined, "DATABASE_OPERATION_FAILED"],
  ];
  for (const [cause, expected] of cases) {
    const error = mapDatabaseError(cause);
    assert.ok(error instanceof PersistenceError);
    assert.equal(error.code, expected);
    assert.equal(
      error.cause,
      cause,
      "neutral classification preserves exact caller-owned cause identity",
    );
    for (const field of ["status", "details", "response", "sql", "detail", "constraint", "errno"])
      assert.equal(
        field in error,
        false,
        "persistence error exposes no transport fields or raw driver details",
      );
  }
});

test("neutral error serialization hides opaque cause and result without freezing or inspecting either payload", () => {
  let inspections = 0;
  const secret = "credential-or-raw-sql-secret";
  const payload = {
    secret,
    toJSON() {
      inspections++;
      throw new Error("must remain opaque");
    },
  };
  const error = new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", {
    cause: payload,
    data: "unknown",
    result: { ok: false, error: payload },
  });
  assert.equal(error.cause, payload);
  assert.ok(error.result && !error.result.ok);
  assert.equal(error.result.error, payload);
  assert.equal(Object.getOwnPropertyDescriptor(error, "cause")?.enumerable, false);
  assert.equal(Object.getOwnPropertyDescriptor(error, "result")?.enumerable, false);
  assert.equal(Object.isFrozen(error.result), true);
  assert.equal(
    Object.isFrozen(payload),
    false,
    "neutral errors leave opaque payload ownership with their caller",
  );
  const serialized = JSON.stringify(error);
  assert.equal(
    serialized.includes(secret),
    false,
    "serialization cannot expose driver cause or observed business payload",
  );
  assert.equal(inspections, 0, "serialization never calls opaque payload toJSON hooks");
  assert.equal(error.message, "Database transaction outcome is unknown.");
  assert.equal(error.data, "unknown");
  const mapped = mapDatabaseError({
    code: "23505",
    detail: secret,
    constraint: secret,
    message: secret,
  });
  assert.equal(JSON.stringify(mapped).includes(secret), false);
  assert.equal(mapped.message.includes(secret), false);
  assert.equal(
    mapDatabaseError(error),
    error,
    "existing neutral error is not wrapped or reclassified",
  );
});

test("tagged result observations preserve explicit undefined and falsy success or failure payloads", () => {
  for (const payload of [undefined, false, 0, "", null]) {
    for (const ok of [true, false]) {
      const source = ok
        ? { ok: true as const, value: payload }
        : { ok: false as const, error: payload };
      const error = new PersistenceError("DATABASE_POST_COMMIT_FAILED", {
        cause: undefined,
        data: "committed",
        result: source,
      });
      assert.equal(
        Object.hasOwn(error, "cause"),
        true,
        "an explicit undefined cause retains its own presence",
      );
      assert.ok(error.result);
      assert.equal(
        Object.hasOwn(error.result, ok ? "value" : "error"),
        true,
        "tagged observation retains an explicit payload field even when undefined",
      );
      assert.notEqual(
        error.result,
        source,
        "error snapshots the tagged record without taking the caller's mutable container",
      );
      assert.equal(error.result?.ok, ok);
      assert.equal(
        error.result && (error.result.ok ? error.result.value : error.result.error),
        payload,
      );
      assert.equal(Object.isFrozen(error.result), true);
      assert.equal(Object.isFrozen(source), false);
    }
  }
  const absent = new PersistenceError("DATABASE_TRANSACTION_FAILED");
  assert.equal(Object.hasOwn(absent, "cause"), false);
  assert.equal(Object.hasOwn(absent, "result"), false);
  const nullPrototype = Object.assign(Object.create(null), { ok: true, value: undefined });
  const explicit = new PersistenceError("DATABASE_TRANSACTION_FAILED", { result: nullPrototype });
  assert.deepEqual(explicit.result, { ok: true, value: undefined });
});

test("neutral error construction rejects invalid codes dispositions and malformed tagged records before invoking accessors", () => {
  for (const value of [
    undefined,
    null,
    "toString",
    "constructor",
    "DATABASE_UNKNOWN_TYPO",
    0,
    Symbol("invalid"),
  ])
    assert.throws(() => new PersistenceError(value as PersistenceErrorCode), TypeError);
  for (const value of [null, false, 0, "rollback", {}, []])
    assert.throws(
      () =>
        new PersistenceError("DATABASE_TRANSACTION_FAILED", {
          data: value,
        } as unknown as PersistenceErrorOptions),
      TypeError,
    );
  class ForeignResult {
    ok = true;
    value = 1;
  }
  let reads = 0;
  const okAccessor = Object.defineProperty({ value: 1 }, "ok", {
    get() {
      reads++;
      return true;
    },
  });
  const valueAccessor = Object.defineProperty({ ok: true }, "value", {
    get() {
      reads++;
      return 1;
    },
  });
  const errorAccessor = Object.defineProperty({ ok: false }, "error", {
    get() {
      reads++;
      return undefined;
    },
  });
  for (const result of [
    null,
    false,
    1,
    "bad",
    [],
    {},
    { ok: 1, value: 1 },
    { ok: true },
    { ok: false },
    Object.create({ ok: true, value: 1 }),
    new ForeignResult(),
    okAccessor,
    valueAccessor,
    errorAccessor,
  ])
    assert.throws(
      () =>
        new PersistenceError("DATABASE_TRANSACTION_FAILED", {
          result,
        } as unknown as PersistenceErrorOptions),
      TypeError,
      "invalid tagged persistence observations reject rather than inventing payloads",
    );
  assert.equal(reads, 0, "tag validation never evaluates result accessors");
});

test("generic wrappers do not mistake filesystem or malformed numeric errno values for PostgreSQL failures", async () => {
  const domainValues = [
    Object.assign(new Error("missing file"), { code: "ENOENT", errno: -2 }),
    Object.assign(new Error("file permission"), { code: "EACCES", errno: -13 }),
    { errno: Number.NaN },
    { errno: Number.POSITIVE_INFINITY },
    { errno: Number.NEGATIVE_INFINITY },
    { errno: 100000 },
    { errno: Number.MAX_SAFE_INTEGER },
    { code: "DOMAIN_REJECTED", errno: 23505 },
  ];
  for (const value of domainValues) {
    const observed = await withDatabaseErrorHandling(async () => {
      throw value;
    }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    assert.equal(observed.ok, false);
    if (!observed.ok)
      assert.equal(
        observed.error,
        value,
        "generic wrapper preserves filesystem and nonnative errno rejection identity",
      );
    const boundary = mapDatabaseError(value);
    assert.ok(
      boundary instanceof PersistenceError,
      "explicit native boundary mapping remains neutral even for an unclassified payload",
    );
    assert.equal(boundary.cause, value);
    assert.equal("status" in boundary, false);
  }
});

test("neutral error data validation publishes one captured getter value", () => {
  let reads = 0;
  const options = {
    get data() {
      reads++;
      return reads === 1 ? "committed" : "unvalidated-secret";
    },
  };
  const error = new PersistenceError(
    "DATABASE_POST_COMMIT_FAILED",
    options as unknown as PersistenceErrorOptions,
  );
  assert.equal(
    reads,
    1,
    "persistence disposition reads caller data exactly once before validation and publication",
  );
  assert.equal(
    error.data,
    "committed",
    "published transaction data is the same captured value that was validated",
  );
  assert.equal(JSON.stringify(error).includes("unvalidated-secret"), false);
});

test("database classification and generic wrappers never print raw driver errors", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  const warnings = spyOn(console, "warn").mockImplementation(() => {});
  const logs = spyOn(console, "log").mockImplementation(() => {});
  let calls = -1;
  try {
    const cause = { code: "23505", detail: "private email and SQL", message: "secret" };
    mapDatabaseError(cause);
    await withDatabaseErrorHandling(async () => {
      throw cause;
    }).catch(() => {});
    calls = errors.mock.calls.length + warnings.mock.calls.length + logs.mock.calls.length;
  } finally {
    errors.mockRestore();
    warnings.mockRestore();
    logs.mockRestore();
  }
  assert.equal(calls, 0, "neutral persistence errors must not log opaque driver payloads");
});

describe("withDatabaseErrorHandling", () => {
  test("returns successful operation results", async () => {
    await expect(withDatabaseErrorHandling(async () => "ok")).resolves.toBe("ok");
  });

  test("maps thrown native database errors while preserving an existing neutral error", async () => {
    const native = { errno: "23505", detail: "duplicate" };
    const seen = await withDatabaseErrorHandling(async () => {
      throw native;
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(seen instanceof PersistenceError);
    assert.equal(seen.code, "DATABASE_UNIQUE_CONSTRAINT");
    assert.equal(seen.cause, native);
    const existing = new PersistenceError("DATABASE_TRANSACTION_UNKNOWN", {
      cause: native,
      data: "unknown",
    });
    await expect(
      withDatabaseErrorHandling(async () => {
        throw existing;
      }),
    ).rejects.toBe(existing);
  });

  test("generic wrappers preserve domain HTTP and opaque rejection values rather than recasting them as driver failures", async () => {
    const values: unknown[] = [
      new HttpError(418, "teapot"),
      new ForbiddenError(),
      new Error("domain"),
      { code: "DOMAIN_REJECTED", message: "domain" },
      new AggregateError([undefined], "opaque"),
      undefined,
      null,
      false,
      0,
      "",
      Symbol("domain"),
    ];
    for (const value of values) {
      const seen = await withDatabaseErrorHandling(async () => {
        throw value;
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      assert.equal(seen.ok, false);
      if (!seen.ok)
        assert.equal(
          seen.error,
          value,
          "generic operation wrapper passes unrelated domain or HTTP rejection through by exact identity",
        );
    }
  });
});
