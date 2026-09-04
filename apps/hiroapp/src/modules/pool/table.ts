import { defineTable } from "@getstrata/core/database/table";

export type TalentPoolStatus = "active" | "released";

export interface TalentPoolEntryRecord {
  id: number;
  user_id: number;
  created_by: number;
  tenant_id?: number | null;
  source_application_id: number | null;
  notes: string | null;
  status: TalentPoolStatus;
  created_at: Date | null;
  updated_at: Date | null;
}

export const talentPoolTable = defineTable<TalentPoolEntryRecord, "id">({
  name: "talent_pool_entries",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "created_by",
    "tenant_id",
    "source_application_id",
    "notes",
    "status",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});
