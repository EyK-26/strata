import { describe, expect, test } from "bun:test";
import { assertSafeTestDatabaseReset } from "../helpers/assertSafeTestDatabaseReset";

describe("assertSafeTestDatabaseReset", () => {
  test("allows an explicit override", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        WORKHUB_ALLOW_TEST_DB_RESET: "1",
        APP_ENV: "production",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/prod",
      }),
    ).not.toThrow();
  });

  test("blocks production even when the database name looks like a test db", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        APP_ENV: "production",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/bun_testing_test",
      }),
    ).toThrow(/APP_ENV=production/);
  });

  test("blocks non-test database urls", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        APP_ENV: "local",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/workhub",
      }),
    ).toThrow(/does not look like a test database/);
  });

  test("allows the local WorkHub test database url", () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        APP_ENV: "local",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:54329/bun_testing_test",
      }),
    ).not.toThrow();
  });
});
