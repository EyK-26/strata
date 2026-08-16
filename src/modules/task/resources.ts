import {
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "@getstrata/core/http/resources";
import type { PaginationMeta } from "@getstrata/core/pagination";
import type { TaskWithProjectRecord } from "./types";

interface TaskResource {
  id: number;
  project_id: number;
  title: string;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
  project?: {
    id: number;
    name: string;
    organization_id: number;
  };
}

function toTaskResource(record: TaskWithProjectRecord): TaskResource {
  return {
    id: record.id,
    project_id: record.project_id,
    title: record.title,
    status: record.status,
    priority: record.priority,
    created_at: serializeDate(record.created_at),
    updated_at: serializeDate(record.updated_at),
    ...(record.project ? { project: record.project } : {}),
  };
}

function toTaskResourceCollection(records: readonly TaskWithProjectRecord[]): TaskResource[] {
  return toResourceCollection(records, toTaskResource);
}

function toTaskPaginatedResourceCollection(
  records: readonly TaskWithProjectRecord[],
  meta: PaginationMeta,
) {
  return toPaginatedResourceCollection(records, meta, toTaskResource);
}

export type { TaskResource };
export { toTaskPaginatedResourceCollection, toTaskResource, toTaskResourceCollection };
