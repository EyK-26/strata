import { defineTable } from "@getstrata/core/database/table";

export type OnboardingStatus = "open" | "done";

export interface OnboardingItemRecord {
  id: number;
  application_id: number;
  created_by: number;
  completed_by: number | null;
  tenant_id?: number | null;
  title: string;
  notes: string | null;
  status: OnboardingStatus;
  completed_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const onboardingItemTable = defineTable<OnboardingItemRecord, "id">({
  name: "onboarding_items",
  primaryKey: "id",
  columns: [
    "id",
    "application_id",
    "created_by",
    "completed_by",
    "tenant_id",
    "title",
    "notes",
    "status",
    "completed_at",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "ASC" },
});
