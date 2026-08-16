import {
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "@getstrata/core/http/resources";
import type { PaginationMeta } from "@getstrata/core/pagination";
import type { CommentRecord } from "./types";

interface CommentResource {
  id: number;
  task_id: number;
  body: string;
  created_at: string;
}

function toCommentResource(record: CommentRecord): CommentResource {
  return {
    id: record.id,
    task_id: record.task_id,
    body: record.body,
    created_at: serializeDate(record.created_at),
  };
}

function toCommentResourceCollection(records: readonly CommentRecord[]): CommentResource[] {
  return toResourceCollection(records, toCommentResource);
}

function toCommentPaginatedResourceCollection(
  records: readonly CommentRecord[],
  meta: PaginationMeta,
) {
  return toPaginatedResourceCollection(records, meta, toCommentResource);
}

export type { CommentResource };
export { toCommentPaginatedResourceCollection, toCommentResource, toCommentResourceCollection };
