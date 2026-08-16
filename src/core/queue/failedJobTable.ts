import { defineTable } from "@getstrata/core/database/table";
import type { FailedJobRecord } from "./types";

const failedJobTable = defineTable<FailedJobRecord, "id">({
  name: "failed_job",
  primaryKey: "id",
  columns: ["id", "job_name", "payload", "exception", "failed_at"],
  defaultOrderBy: { column: "failed_at", direction: "DESC" },
});

export { failedJobTable };
