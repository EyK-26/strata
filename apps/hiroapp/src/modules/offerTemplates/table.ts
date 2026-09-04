import { defineTable } from "@getstrata/core/database/table";

export interface OfferTemplateRecord {
  id: number;
  created_by: number;
  tenant_id?: number | null;
  name: string;
  body: string;
  salary: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const offerTemplateTable = defineTable<OfferTemplateRecord, "id">({
  name: "offer_templates",
  primaryKey: "id",
  columns: ["id", "created_by", "tenant_id", "name", "body", "salary", "created_at", "updated_at"],
  defaultOrderBy: { column: "name", direction: "ASC" },
});
