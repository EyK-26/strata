import {
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "@getstrata/core/http";
import type { PaginationMeta } from "@getstrata/core/pagination";
import type { AttachmentRecord } from "./types";

interface AttachmentResource {
  id: number;
  task_id: number;
  user_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  download_url: string;
  created_at: string;
}

function toAttachmentResource(record: AttachmentRecord): AttachmentResource {
  return {
    id: record.id,
    task_id: record.task_id,
    user_id: record.user_id,
    original_name: record.original_name,
    mime_type: record.mime_type,
    size_bytes: record.size_bytes,
    download_url: `/api/v1/attachments/${record.id}/download`,
    created_at: serializeDate(record.created_at),
  };
}

function toAttachmentResourceCollection(
  records: readonly AttachmentRecord[],
): AttachmentResource[] {
  return toResourceCollection(records, toAttachmentResource);
}

function toAttachmentPaginatedResourceCollection(
  records: readonly AttachmentRecord[],
  meta: PaginationMeta,
) {
  return toPaginatedResourceCollection(records, meta, toAttachmentResource);
}

export type { AttachmentResource };
export {
  toAttachmentPaginatedResourceCollection,
  toAttachmentResource,
  toAttachmentResourceCollection,
};
