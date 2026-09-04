import { defineTable } from "@getstrata/core/database/table";

export type ReferralStatus = "open" | "applied" | "closed";

export interface ReferralRecord {
  id: number;
  position_id: number;
  referred_by: number;
  tenant_id?: number | null;
  email: string;
  name: string;
  notes: string | null;
  status: ReferralStatus;
  created_at: Date | null;
  updated_at: Date | null;
}

export const referralTable = defineTable<ReferralRecord, "id">({
  name: "referrals",
  primaryKey: "id",
  columns: [
    "id",
    "position_id",
    "referred_by",
    "tenant_id",
    "email",
    "name",
    "notes",
    "status",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
