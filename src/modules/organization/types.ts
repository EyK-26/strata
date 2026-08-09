interface OrganizationRecord {
  id: number;
  tenant_id: number;
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type { OrganizationRecord };
