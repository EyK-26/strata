type OrganizationMemberRole = "owner" | "admin" | "member";

type OrganizationMemberRecord = {
  id: number;
  organization_id: number;
  user_id: number;
  role: OrganizationMemberRole;
  created_at: Date;
};

export type { OrganizationMemberRecord, OrganizationMemberRole };
