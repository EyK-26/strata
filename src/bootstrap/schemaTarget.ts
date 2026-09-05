type SchemaTarget = "app" | "fixture";

function readSchemaTarget(): SchemaTarget {
  const value = (process.env.STRATA_SCHEMA ?? "").trim().toLowerCase();
  return value === "fixture" ? "fixture" : "app";
}

function isFixtureSchema(): boolean {
  return readSchemaTarget() === "fixture";
}

export type { SchemaTarget };
export { isFixtureSchema, readSchemaTarget };
