type OrganizationMemberRole = "owner" | "admin" | "member";

interface MembershipRecord {
  id: number;
  organization_id: number;
  user_id: number;
  role: OrganizationMemberRole;
  created_at: Date;
}

interface MembershipLookup {
  listForUser(userId: number): Promise<MembershipRecord[]>;
  findMembership(userId: number, organizationId: number): Promise<MembershipRecord | null>;
  listForOrganization(organizationId: number): Promise<MembershipRecord[]>;
  addMember(input: {
    organizationId: number;
    userId: number;
    role?: OrganizationMemberRole;
  }): Promise<MembershipRecord>;
  removeMember(organizationId: number, userId: number): Promise<unknown>;
  updateMemberRole(
    organizationId: number,
    userId: number,
    role: OrganizationMemberRole,
  ): Promise<MembershipRecord>;
}

export type { MembershipLookup, MembershipRecord, OrganizationMemberRole };
