import { expect, test } from "bun:test";
import {
  Blueprint,
  compileBlueprint,
  Schema,
  UnsupportedSchemaFeatureError,
} from "@getstrata/core/database/schema";

for (const kind of ["uuid", "string", "integer"] as const) {
  test(`SQLite ${kind}: column-level ALTER uniqueness is diagnosed before execution with the supported index alternative`, () => {
    const schema = Schema.builder("sqlite");
    expect(() =>
      schema.table("invoices", (table) => table[kind]("external_id").nullable().unique()),
    ).toThrow(UnsupportedSchemaFeatureError);
    expect(() =>
      schema.table("invoices", (table) => table[kind]("external_id").nullable().unique()),
    ).toThrow(/table\.unique/);
    expect(schema.toSql()).toEqual([]);
  });
}
for (const driver of ["pgsql", "mysql"] as const) {
  test(`${driver}: UUID ALTER uniqueness retains its existing SQL`, () => {
    const table = new Blueprint("invoices", "alter");
    table.uuid("external_id").nullable().unique();
    expect(compileBlueprint(driver, table)).toEqual(
      driver === "pgsql"
        ? ['ALTER TABLE "invoices"\nADD COLUMN IF NOT EXISTS "external_id" UUID NULL UNIQUE']
        : ["ALTER TABLE `invoices`\nADD COLUMN `external_id` CHAR(36) NULL UNIQUE"],
    );
  });
}
