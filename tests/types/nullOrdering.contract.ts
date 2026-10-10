import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ id: number; attempted: string | null }, "id">({
  name: "receipts",
  primaryKey: "id",
  columns: ["id", "attempted"],
});
class Receipt extends defineModel(table) {}
const repository = new BaseRepository(table);
export function nullOrderingContracts() {
  repository
    .query()
    .orderBy([{ column: "attempted", nulls: "first" }, { column: "id" }])
    .project(["id"]);
  Receipt.query().orderBy({ column: "attempted", direction: "desc", nulls: "last" }).select("id");
  // @ts-expect-error Null placement is an enum, not arbitrary SQL.
  Receipt.query().orderBy({ column: "attempted", nulls: "FIRST; DROP TABLE receipts" });
  // @ts-expect-error Ordering remains restricted to declared columns.
  repository.query().orderBy({ column: "missing", nulls: "first" });
}
