/** Positive public repository contracts. Compiled only; no database or top-level writes. */
import type { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineModel } from "@getstrata/core/database/model";
import { defineTable } from "@getstrata/core/database/table";
export interface LeadRecord {
  id: string;
  email: string;
  attempts: number;
}
export class Lead extends defineModel(
  defineTable<LeadRecord, "id">({
    name: "leads",
    primaryKey: "id",
    columns: ["id", "email", "attempts"],
  }),
) {}
class ChildLead extends Lead {}
interface StockRecord {
  sku: string;
  quantity: number;
}
export class Stock extends defineModel(
  defineTable<StockRecord, "sku">({
    name: "stock",
    primaryKey: "sku",
    columns: ["sku", "quantity"],
  }),
) {}
class LegacyLead extends Lead {
  static override repository<
    TEntity extends object,
    PrimaryKey extends keyof TEntity & string,
  >(): BaseRepository<TEntity, PrimaryKey> {
    return Lead.repository<TEntity, PrimaryKey>();
  }
}
export async function validRepositoryContracts() {
  const inferred = Lead.repository();
  const checked: BaseRepository<LeadRecord, "id"> = inferred;
  void checked;
  const explicit: BaseRepository<LeadRecord, "id"> = Lead.repository<LeadRecord, "id">();
  const inherited = ChildLead.repository();
  for (const repository of [
    inferred,
    explicit,
    inherited,
    LegacyLead.repository<LeadRecord, "id">(),
  ]) {
    const result = await repository.upsert(
      { id: "fixture", email: "fixture@example.test", attempts: 0 },
      ["email"],
      ["email"],
    );
    if (result) {
      const row: LeadRecord = result;
      const email: string = row.email;
      void email;
    }
    const found = await repository.findById("fixture");
    if (found) {
      const id: string = found.id;
      void id;
    }
  }
  const stock = Stock.repository();
  const key: "sku" = stock.getTable().primaryKey;
  const result = await stock.upsert({ sku: "fixture", quantity: 0 }, ["sku"], ["quantity"]);
  if (result) {
    const sku: string = result.sku;
    const quantity: number = result.quantity;
    void sku;
    void quantity;
  }
  void key;
}
