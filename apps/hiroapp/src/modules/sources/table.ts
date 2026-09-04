import { defineTable } from "@getstrata/core/database/table";

export interface ApplicationSourceRecord {
  id: number;
  name: string;
  created_at: Date | null;
  updated_at: Date | null;
}

export interface ApplicationAttributionRecord {
  id: number;
  application_id: number;
  source_id: number;
  created_by: number;
  tenant_id?: number | null;
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const applicationSourceTable = defineTable<ApplicationSourceRecord, "id">({
  name: "application_sources",
  primaryKey: "id",
  columns: ["id", "name", "created_at", "updated_at"],
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export const applicationAttributionTable = defineTable<ApplicationAttributionRecord, "id">({
  name: "application_attributions",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "source_id",
    "created_by",
    "tenant_id",
    "notes",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
