import { expect, test } from "bun:test";
import { Blueprint, compileBlueprint } from "@getstrata/core/database/schema";

test("explicit bigId generates 64-bit primary keys in every schema grammar", () => {
  const schema = new Blueprint("orders", "create");
  const column = schema.bigId("order_id");
  expect(column.kind).toBe("bigId");
  expect(column.isPrimary).toBe(true);
  expect(column.autoIncrement).toBe(true);
  expect(compileBlueprint("pgsql", schema)[0]).toContain('"order_id" BIGSERIAL PRIMARY KEY');
  expect(compileBlueprint("mysql", schema)[0]).toContain(
    "`order_id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY",
  );
  expect(compileBlueprint("sqlite", schema)[0]).toContain(
    '"order_id" INTEGER PRIMARY KEY AUTOINCREMENT',
  );
});
test("ordinary id and non-generated bigInteger retain their existing types", () => {
  const normal = new Blueprint("orders", "create");
  normal.id();
  normal.bigInteger("parent_id");
  expect(compileBlueprint("pgsql", normal)[0]).toContain('"id" SERIAL');
  expect(compileBlueprint("pgsql", normal)[0]).toContain('"parent_id" BIGINT NOT NULL');
  const implicit = new Blueprint("orders", "create");
  implicit.bigId();
  expect(implicit.columns[0]?.name).toBe("id");
});
