import { describe, expect, test } from "bun:test";
import { envFlagEnabled, isProductionEnv } from "@getstrata/core/runtime/appEnv";

describe("isProductionEnv", () => {
  test("treats APP_ENV=production and NODE_ENV=production as production", () => {
    expect(isProductionEnv({ APP_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ APP_ENV: "local", NODE_ENV: "production" })).toBe(true);
  });

  test("is case-insensitive for production", () => {
    expect(isProductionEnv({ APP_ENV: "Production" })).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "PRODUCTION" })).toBe(true);
  });

  test("keeps known non-production app envs off unless NODE_ENV is production", () => {
    expect(isProductionEnv({})).toBe(false);
    expect(isProductionEnv({ APP_ENV: "local" })).toBe(false);
    expect(isProductionEnv({ APP_ENV: "development" })).toBe(false);
    expect(isProductionEnv({ APP_ENV: "test" })).toBe(false);
    expect(isProductionEnv({ APP_ENV: "staging" })).toBe(false);
    expect(isProductionEnv({ NODE_ENV: "test" })).toBe(false);
  });

  test("default-denies unrecognized APP_ENV values", () => {
    expect(isProductionEnv({ APP_ENV: "prod" })).toBe(true);
    expect(isProductionEnv({ APP_ENV: "Prod" })).toBe(true);
    expect(isProductionEnv({ APP_ENV: "live" })).toBe(true);
  });
});

describe("envFlagEnabled", () => {
  test("is true only for the exact string true", () => {
    expect(envFlagEnabled("true")).toBe(true);
    expect(envFlagEnabled(undefined)).toBe(false);
    expect(envFlagEnabled("false")).toBe(false);
    expect(envFlagEnabled("FALSE")).toBe(false);
    expect(envFlagEnabled("0")).toBe(false);
    expect(envFlagEnabled("off")).toBe(false);
    expect(envFlagEnabled("True")).toBe(false);
  });
});
