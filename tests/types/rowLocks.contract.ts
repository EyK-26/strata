import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ id: number; stock: number }, "id">({
  name: "stock",
  primaryKey: "id",
  columns: ["id", "stock"],
});
class Stock extends defineModel(table) {}
export async function lockContracts(): Promise<void> {
  const row: Stock | null = await Stock.query().where({ id: 1 }).lockForUpdate().first();
  const projection: { stock: number } | null = await Stock.query()
    .sharedLock({ wait: "nowait" })
    .select("stock")
    .first();
  void row;
  void projection;
  // @ts-expect-error Invalid wait mode cannot be admitted by typed consumers.
  Stock.query().lockForUpdate({ wait: "forever" });
}
