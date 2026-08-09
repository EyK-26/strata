import { defineTable } from "@getstrata/core/database";
import { ORGANIZATION_TABLE } from "../../domain/workhub";
import type { OrganizationRecord } from "./types";

const organizationTable = defineTable<OrganizationRecord, "id">({
  name: ORGANIZATION_TABLE,
  primaryKey: "id",
  columns: ["id", "tenant_id", "name", "slug", "created_at", "updated_at", "deleted_at"],
  softDeletes: true,
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { organizationTable };
