import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineTable } from "@getstrata/core/database/table";

const lines = new BaseRepository(
  defineTable<{ id: number; product_id: number; quantity: number }, "id">({
    name: "lines",
    primaryKey: "id",
    columns: ["id", "product_id", "quantity"],
  }),
);
export async function groupedSumContracts() {
  const rows: Array<{ value: number | null; sum: string | null }> = await lines
    .query()
    .where({ id: 1 })
    .sumBy("product_id", "quantity");
  // @ts-expect-error Group columns must be declared.
  lines.query().sumBy("unknown", "quantity");
  // @ts-expect-error Aggregate columns must be declared.
  lines.sumBy("product_id", "unknown");
  // @ts-expect-error Totals are exact text, not implicit potentially rounded numbers.
  const total: number = rows[0]?.sum;
  void total;
}
