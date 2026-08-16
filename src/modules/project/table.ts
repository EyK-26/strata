import { defineTable } from "@getstrata/core/database/table";
import { PROJECT_TABLE } from "../../domain/workhub";
import type { ProjectRecord } from "./types";

const projectTable = defineTable<ProjectRecord, "id">({
  name: PROJECT_TABLE,
  primaryKey: "id",
  columns: [
    "id",
    "organization_id",
    "tenant_id",
    "name",
    "status",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  softDeletes: true,
  defaultOrderBy: { column: "id", direction: "ASC" },
});

export { projectTable };
