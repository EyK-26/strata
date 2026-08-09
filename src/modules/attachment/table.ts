import { defineTable } from "@getstrata/core/database";
import { TASK_ATTACHMENT_TABLE } from "../../domain/workhub";
import type { AttachmentRecord } from "./types";

const attachmentTable = defineTable<AttachmentRecord, "id">({
  name: TASK_ATTACHMENT_TABLE,
  primaryKey: "id",
  columns: [
    "id",
    "task_id",
    "tenant_id",
    "user_id",
    "original_name",
    "storage_path",
    "mime_type",
    "size_bytes",
    "created_at",
    "deleted_at",
  ],
  softDeletes: true,
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});

export { attachmentTable };
