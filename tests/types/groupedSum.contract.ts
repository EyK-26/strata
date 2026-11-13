import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";

const repositoryDefinition = defineRepository({
  name: "groupedSum",
  table: defineTable<{ id: number; product_id: number; quantity: number }, "id">({
    name: "lines",
    primaryKey: "id",
    columns: ["id", "product_id", "quantity"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
export async function groupedSumContracts(database: DatabaseSession) {
  const lines = database.repository(repositoryDefinition);
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
