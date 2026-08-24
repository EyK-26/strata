import { afterEach, describe, expect, test } from "bun:test";
import {
  LOCAL_LOGIN_RATE_LIMIT,
  PRODUCTION_LOGIN_RATE_LIMIT,
  resolveLoginRateLimit,
} from "../../src/config/rateLimit";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("resolveLoginRateLimit", () => {
  const previousEnv = process.env.APP_ENV;
  const previousMax = process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
  const previousWindow = process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
  const previousWindowMs = process.env.LOGIN_RATE_LIMIT_WINDOW_MS;

  afterEach(() => {
    restoreEnvVar("APP_ENV", previousEnv);
    restoreEnvVar("LOGIN_RATE_LIMIT_PER_WINDOW", previousMax);
    restoreEnvVar("LOGIN_RATE_LIMIT_WINDOW_SECONDS", previousWindow);
    restoreEnvVar("LOGIN_RATE_LIMIT_WINDOW_MS", previousWindowMs);
  });

  test("uses relaxed defaults in local env", () => {
    process.env.APP_ENV = "local";
    delete process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;

    expect(resolveLoginRateLimit()).toEqual(LOCAL_LOGIN_RATE_LIMIT);
  });

  test("uses strict defaults outside local env", () => {
    process.env.APP_ENV = "production";
    delete process.env.LOGIN_RATE_LIMIT_PER_WINDOW;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;

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

  test("accepts deprecated LOGIN_RATE_LIMIT_WINDOW_MS as an alias", () => {
    process.env.APP_ENV = "local";
    delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "45000";

    expect(resolveLoginRateLimit()).toEqual({
      maxAttempts: LOCAL_LOGIN_RATE_LIMIT.maxAttempts,
      decaySeconds: 45,
    });
  });
});
