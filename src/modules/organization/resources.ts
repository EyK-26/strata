import {
  JsonResource,
  serializeDate,
  toPaginatedResourceCollection,
  toResourceCollection,
} from "@getstrata/core/http/resources";
import type { PaginationMeta } from "@getstrata/core/pagination";
import type { OrganizationRecord } from "./types";

interface OrganizationResource {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

class OrganizationJsonResource extends JsonResource<OrganizationRecord> {
  override toArray(): Record<string, unknown> {
    const record = this.resource;

    return {
      id: record.id,
      name: record.name,
      slug: record.slug,
      created_at: serializeDate(record.created_at),
      updated_at: serializeDate(record.updated_at),
    };
  }
}

function toOrganizationResource(record: OrganizationRecord): OrganizationResource {
  return new OrganizationJsonResource(record).toArray() as unknown as OrganizationResource;
}

function toOrganizationResourceCollection(
  records: readonly OrganizationRecord[],
): OrganizationResource[] {
  return toResourceCollection(records, toOrganizationResource);
}

function toOrganizationPaginatedResourceCollection(
  records: readonly OrganizationRecord[],
  meta: PaginationMeta,
) {
  return toPaginatedResourceCollection(records, meta, toOrganizationResource);
}

export type { OrganizationResource };
export {
  OrganizationJsonResource,
  toOrganizationPaginatedResourceCollection,
  toOrganizationResource,
  toOrganizationResourceCollection,
};
