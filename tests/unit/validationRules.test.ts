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
