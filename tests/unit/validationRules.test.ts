import { describe, expect, test } from "bun:test";
import { ValidationError } from "@getstrata/core/errors/http";
import {
  confirmed,
  emailRule,
  enumRule,
  integerRange,
  integerRule,
  maxLength,
  minLength,
  optional,
  pattern,
  positiveIntegerRule,
  required,
  stringRule,
  validateObject,
} from "@getstrata/core/validation/rules";

describe("validateObject", () => {
  test("returns validated values for a matching payload", () => {
    const result = validateObject(
      { name: "Acme Labs", slug: "acme-labs" },
      {
        name: [required(), stringRule(), minLength(1), maxLength(120)],
        slug: [required(), stringRule(), pattern(/^[a-z0-9-]+$/)],
      },
    );

    expect(result).toEqual({
      name: "Acme Labs",
      slug: "acme-labs",
    });
  });

  test("throws a validation error with field messages", () => {
    try {
      validateObject(
        { name: "", slug: "Bad Slug" },
        {
          name: [required(), stringRule(), minLength(1)],
          slug: [required(), stringRule(), pattern(/^[a-z0-9-]+$/)],
        },
      );
      throw new Error("Expected validateObject to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual({
        name: ['"name" is required.', '"name" must be at least 1 characters.'],
        slug: ['"slug" has an invalid format.'],
      });
    }
  });

  test("validates enum values", () => {
    expect(() =>
      validateObject(
        { status: "invalid" },
        {
          status: [required(), enumRule(["draft", "active"])],
        },
      ),
    ).toThrow(ValidationError);
  });

  test("validates integer and email rules", () => {
    expect(() =>
      validateObject(
        { priority: "high", email: "not-an-email" },
        {
          priority: [required(), integerRule()],
          email: [required(), emailRule()],
        },
      ),
    ).toThrow(ValidationError);

    const result = validateObject(
      { priority: "3", email: "ops@example.com" },
      {
        priority: [required(), integerRule()],
        email: [required(), emailRule()],
      },
    );

    expect(result).toEqual({
      priority: "3",
      email: "ops@example.com",
    });
  });

  test("validates confirmed fields", () => {
    expect(() =>
      validateObject(
        { password: "secret", password_confirmation: "different" },
        {
          password: [required(), stringRule(), confirmed("password")],
        },
      ),
    ).toThrow(ValidationError);

    const result = validateObject(
      { password: "secret", password_confirmation: "secret" },
      {
        password: [required(), stringRule(), confirmed("password")],
      },
    );

    expect(result.password).toBe("secret");
  });

  test("validates optional, string, length, integer range, and positive integer rules", () => {
    expect(optional()("name", "value", {})).toBeUndefined();

    expect(stringRule()("name", 42, {})).toBe('"name" must be a string.');
    expect(maxLength(3)("name", "abcd", {})).toContain("at most 3");
    expect(positiveIntegerRule()("count", 0, {})).toContain("positive integer");
    expect(positiveIntegerRule()("count", "", {})).toBeUndefined();
    expect(integerRange(1, 5)("count", 9, {})).toContain("between 1 and 5");
    expect(integerRange(1, 5)("count", "", {})).toBeUndefined();
    expect(pattern(/^[a-z]+$/)("slug", 42, {})).toBeUndefined();

    expect(() =>
      validateObject(null, {
        name: [required()],
      }),
    ).toThrow(ValidationError);
  });
});

describe("complete safe integer validation", () => {
  const rules = [integerRule(), positiveIntegerRule(), integerRange(1, 10)];
  test("rejects malformed retained values without coercing objects", () => {
    const unsafe: unknown[] = [
      "2oops",
      "2.5",
      "2e3",
      "0x2",
      "2 3",
      " ",
      2.5,
      NaN,
      Infinity,
      9007199254740992,
      "9007199254740993",
      true,
      [],
      [2],
      {},
      {
        toString() {
          throw new Error("must not coerce");
        },
      },
    ];
    for (const rule of rules)
      for (const value of unsafe) {
        expect(() => validateObject({ quantity: value }, { quantity: [rule] })).toThrow(
          ValidationError,
        );
      }
  });
  test("preserves valid form strings, optional values and required error contracts", () => {
    for (const rule of rules) {
      for (const value of [2, "2", " +02 "])
        expect(validateObject({ quantity: value }, { quantity: [rule] })).toEqual({
          quantity: typeof value === "string" ? value.trim() : value,
        });
      for (const value of [undefined, null, ""])
        expect(rule("quantity", value, {})).toBeUndefined();
      expect(() => validateObject({ quantity: "" }, { quantity: [required(), rule] })).toThrow(
        ValidationError,
      );
    }
    expect(integerRule()("n", Number.MAX_SAFE_INTEGER, {})).toBeUndefined();
    expect(integerRule()("n", Number.MIN_SAFE_INTEGER, {})).toBeUndefined();
    expect(integerRule()("n", "-02", {})).toBeUndefined();
    expect(positiveIntegerRule()("n", "0", {})).toBe('"n" must be a positive integer.');
    expect(integerRange(0, 10)("n", 0, {})).toBeUndefined();
    expect(integerRange(0, 10)("n", 10, {})).toBeUndefined();
    expect(integerRange(0, 10)("n", 11, {})).toBe('"n" must be an integer between 0 and 10.');
  });
  test("offers opt-in JSON-number-only rules without changing output normalization", () => {
    for (const rule of [
      integerRule({ allowNumericStrings: false }),
      positiveIntegerRule({ allowNumericStrings: false }),
      integerRange(0, 10, { allowNumericStrings: false }),
    ]) {
      expect(validateObject({ n: 2 }, { n: [rule] })).toEqual({ n: 2 });
      expect(() => validateObject({ n: "2" }, { n: [rule] })).toThrow(ValidationError);
    }
  });
  test("rejects invalid range configurations before validating requests", () => {
    for (const [min, max] of [
      [2, 1],
      [NaN, 2],
      [0, Infinity],
      [0.5, 2],
      [0, 9007199254740992],
    ])
      expect(() => integerRange(min!, max!)).toThrow(TypeError);
  });
});
