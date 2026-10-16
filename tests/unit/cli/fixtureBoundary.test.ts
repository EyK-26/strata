import { afterEach, expect, test } from "bun:test";
import { assertFixtureSchema } from "../../../src/bootstrap/schemaTarget";
import { restoreEnvVar } from "../../helpers/restoreEnv";

const previous = {
  schema: process.env.STRATA_SCHEMA,
  mode: process.env.APP_ENV,
  node: process.env.NODE_ENV,
};
afterEach(() => {
  restoreEnvVar("STRATA_SCHEMA", previous.schema);
  restoreEnvVar("APP_ENV", previous.mode);
  restoreEnvVar("NODE_ENV", previous.node);
});

test("private fixture CLI refuses missing/app targets and staging/production before database access", () => {
  for (const target of [undefined, "app", "misspelled"]) {
    restoreEnvVar("STRATA_SCHEMA", target);
    expect(() => assertFixtureSchema()).toThrow("STRATA_SCHEMA=fixture");
  }
  process.env.STRATA_SCHEMA = "fixture";
  process.env.NODE_ENV = "test";
  for (const mode of ["production", "staging"]) {
    process.env.APP_ENV = mode;
    expect(() => assertFixtureSchema()).toThrow("disabled outside development/test");
  }
  process.env.APP_ENV = "local";
  process.env.NODE_ENV = "production";
  expect(() => assertFixtureSchema()).toThrow("disabled outside development/test");
  process.env.NODE_ENV = "test";
  for (const mode of ["local", "test", "testing", "development"]) {
    process.env.APP_ENV = mode;
    expect(() => assertFixtureSchema()).not.toThrow();
  }
});
