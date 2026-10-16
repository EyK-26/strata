import { isProductionEnv } from "@getstrata/core/runtime/appEnv";

type SchemaTarget = "app" | "fixture";

function readSchemaTarget(): SchemaTarget {
  const value = (process.env.STRATA_SCHEMA ?? "").trim().toLowerCase();
  return value === "fixture" ? "fixture" : "app";
}

function isFixtureSchema(): boolean {
  return readSchemaTarget() === "fixture";
}

function assertFixtureSchema(): void {
  if (!isFixtureSchema()) {
    throw new Error(
      "The repository CLI only manages framework test fixtures. Set STRATA_SCHEMA=fixture; run an app's strata CLI from its own directory.",
    );
  }
  if (isProductionEnv()) {
    throw new Error(
      "Framework fixture commands are disabled outside development/test environments.",
    );
  }
}

export type { SchemaTarget };
export { assertFixtureSchema, isFixtureSchema, readSchemaTarget };
