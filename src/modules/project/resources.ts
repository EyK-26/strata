import {
  JsonResource,
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "@getstrata/core/http/resources";
import type { PaginationMeta } from "@getstrata/core/pagination";
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

class ProjectJsonResource extends JsonResource<ProjectWithOrganizationRecord> {
  override toArray(): Record<string, unknown> {
    const record = this.resource;

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
}

function toProjectResource(record: ProjectWithOrganizationRecord): ProjectResource {
  return new ProjectJsonResource(record).toArray() as unknown as ProjectResource;
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
export {
  ProjectJsonResource,
  toProjectPaginatedResourceCollection,
  toProjectResource,
  toProjectResourceCollection,
};
