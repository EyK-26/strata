import { expect, test } from "bun:test";
import { Blueprint, compileBlueprint } from "@getstrata/core/database/schema";

test("UUID columns preserve the native PostgreSQL type and explicit string storage elsewhere", () => {
  const table = new Blueprint("documents", "create");
  const id = table.uuid("id").primary();
  table.uuid("external_id").nullable().unique();
  expect(id.kind).toBe("uuid");
  expect(id.autoIncrement).toBe(false);
  expect(compileBlueprint("pgsql", table)[0]).toContain('"id" UUID PRIMARY KEY');
  expect(compileBlueprint("mysql", table)[0]).toContain("`id` CHAR(36) PRIMARY KEY");
  expect(compileBlueprint("sqlite", table)[0]).toContain('"id" TEXT PRIMARY KEY NOT NULL');
  expect(compileBlueprint("pgsql", table)[0]).toContain('"external_id" UUID NULL UNIQUE');
});

test("UUID alterations and explicit defaults follow ordinary column conventions", () => {
  const table = new Blueprint("documents", "alter");
  table.uuid("correlation_id").nullable();
  table.uuid("owner_id").default("11111111-1111-4111-8111-111111111111");
  expect(compileBlueprint("pgsql", table)).toEqual([
    'ALTER TABLE "documents"\nADD COLUMN IF NOT EXISTS "correlation_id" UUID NULL',
    'ALTER TABLE "documents"\nADD COLUMN IF NOT EXISTS "owner_id" UUID NOT NULL DEFAULT \'11111111-1111-4111-8111-111111111111\'',
  ]);
});

for (const driver of ["pgsql", "mysql", "sqlite"] as const) {
  test(`${driver}: UUID does not silently turn auto-increment into another key type`, () => {
    const table = new Blueprint("documents", "create");
    table.uuid("id").autoIncrement = true;
    expect(() => compileBlueprint(driver, table)).toThrow(
      /auto-increment.*UUID|UUID.*auto-increment/,
    );
  });
}
