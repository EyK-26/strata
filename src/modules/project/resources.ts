import {
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "../../core/http";
import type { PaginationMeta } from "../../core/pagination";
import type { ProjectWithOrganizationRecord } from "./types";

interface ProjectResource {
  id: number;
  organization_id: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  organization?: {
    id: number;
    name: string;
    slug: string;
  };
}

function toProjectResource(record: ProjectWithOrganizationRecord): ProjectResource {
  return {
    id: record.id,
    organization_id: record.organization_id,
    name: record.name,
    status: record.status,
    created_at: serializeDate(record.created_at),
    updated_at: serializeDate(record.updated_at),
    ...(record.organization ? { organization: record.organization } : {}),
  };
}

function toProjectResourceCollection(
  records: readonly ProjectWithOrganizationRecord[],
): ProjectResource[] {
  return toResourceCollection(records, toProjectResource);
}

function toProjectPaginatedResourceCollection(
  records: readonly ProjectWithOrganizationRecord[],
  meta: PaginationMeta,
) {
  return toPaginatedResourceCollection(records, meta, toProjectResource);
}

export type { ProjectResource };
export { toProjectPaginatedResourceCollection, toProjectResource, toProjectResourceCollection };
