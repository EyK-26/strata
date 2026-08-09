import type { ProjectStatus } from "../../domain/workhub";

interface ProjectRecord {
  id: number;
  organization_id: number;
  tenant_id: number;
  name: string;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface ProjectWithOrganizationRecord extends ProjectRecord {
  organization?: {
    id: number;
    name: string;
    slug: string;
  };
}

export type { ProjectRecord, ProjectWithOrganizationRecord };
