import { afterEach, describe, expect, test } from "bun:test";
import {
  LOCAL_LOGIN_RATE_LIMIT,
  PRODUCTION_LOGIN_RATE_LIMIT,
  resolveLoginRateLimit,
} from "../../src/config/rateLimit";

describe("resolveLoginRateLimit", () => {
  const previousEnv = process.env.APP_ENV;
  const previousMax = process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
  const previousWindow = process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousEnv;
    }

    if (previousMax === undefined) {
      delete process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
    } else {
      process.env.LOGIN_RATE_LIMIT_PER_WINDOW = previousMax;
    }

    if (previousWindow === undefined) {
      delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
    } else {
      process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = previousWindow;
    }
  });

  test("uses relaxed defaults in local env", () => {
    process.env.APP_ENV = "local";
    delete process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;

    expect(resolveLoginRateLimit()).toEqual(LOCAL_LOGIN_RATE_LIMIT);
  });

  test("uses strict defaults outside local env", () => {
    process.env.APP_ENV = "production";
    delete process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;

    expect(resolveLoginRateLimit()).toEqual(PRODUCTION_LOGIN_RATE_LIMIT);
  });

  test("allows explicit overrides", () => {
    process.env.APP_ENV = "local";
    process.env.LOGIN_RATE_LIMIT_PER_WINDOW = "7";
    process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = "120";

    expect(resolveLoginRateLimit()).toEqual({
      maxAttempts: 7,
      decaySeconds: 120,
    });
  });
});
