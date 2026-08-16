import { describe, expect, test } from "bun:test";
import { defineEnvSchema, validateEnv } from "@getstrata/core/config/envSchema";

describe("validateEnv", () => {
  test("accepts a valid environment map", () => {
    expect(() =>
      validateEnv(
        defineEnvSchema({
          DATABASE_URL: { required: true, pattern: /^postgres/ },
          PORT: { integer: true, minimum: 1, default: "3000" },
        }),
        {
          DATABASE_URL: "postgresql://postgres:postgres@localhost/workhub",
          PORT: "3000",
        },
      ),
    ).not.toThrow();
  });

  test("throws when a required variable is missing", () => {
    expect(() =>
      validateEnv(
        defineEnvSchema({
          DATABASE_URL: { required: true },
        }),
        {},
      ),
    ).toThrow('Missing required environment variable "DATABASE_URL".');
  });

  test("throws when an integer variable is invalid", () => {
    expect(() =>
      validateEnv(
        defineEnvSchema({
          PORT: { integer: true, minimum: 1 },
        }),
        { PORT: "abc" },
      ),
    ).toThrow('Environment variable "PORT" must be an integer >= 1.');
  });

  test("applies defaults for optional variables", () => {
    const resolved = validateEnv(
      defineEnvSchema({
        CACHE_TTL_MS: { integer: true, minimum: 0, default: "3600000" },
      }),
      {},
    );

    expect(resolved.CACHE_TTL_MS).toBe("3600000");
  });
});
