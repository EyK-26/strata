import { ForbiddenError } from "@getstrata/core/errors/http";
import type { OrganizationMemberRole } from "../../modules/organization/memberTypes";
import { hasMinimumOrgRole, isGlobalAdmin, resolveUserId } from "./accessControl";
import { type AuthUser, currentAuthUser } from "./authContext";
import { membershipRepository as defaultMembershipRepository } from "./membershipContext";

type MembershipRepositoryLike = Pick<
  typeof defaultMembershipRepository,
  "listForUser" | "findMembership" | "listForOrganization" | "addMember" | "removeMember"
>;

class MembershipService {
  constructor(private readonly members: MembershipRepositoryLike = defaultMembershipRepository) {}

  async listOrganizationIdsForUser(userId: number): Promise<number[]> {
    const memberships = await this.members.listForUser(userId);
    return memberships.map((membership) => membership.organization_id);
  }

  async getOrgRole(userId: number, organizationId: number): Promise<OrganizationMemberRole | null> {
    const membership = await this.members.findMembership(userId, organizationId);
    return membership?.role ?? null;
  }

  async requireOrgAccess(
    organizationId: number,
    minimumRole: OrganizationMemberRole = "member",
    user: AuthUser | null = currentAuthUser(),
  ): Promise<OrganizationMemberRole> {
    if (!user) {
      throw new ForbiddenError("Authentication required.");
    }

    if (isGlobalAdmin(user)) {
      return "owner";
    }

    const role = await this.getOrgRole(resolveUserId(user), organizationId);

    if (!role || !hasMinimumOrgRole(role, minimumRole)) {
      throw new ForbiddenError("Organization membership required.");
    }

    return role;
  }

  async filterAccessibleOrganizationIds(
    organizationIds: number[],
    user: AuthUser | null = currentAuthUser(),
  ): Promise<number[]> {
    if (!user) {
      return [];
    }

    if (isGlobalAdmin(user)) {
      return organizationIds;
    }

    const allowed = new Set(await this.listOrganizationIdsForUser(resolveUserId(user)));
    return organizationIds.filter((organizationId) => allowed.has(organizationId));
  }

  async addOwnerOnOrganizationCreate(organizationId: number, userId: number): Promise<void> {
    await this.members.addMember({
      organizationId,
      userId,
      role: "owner",
    });
  }

  listMembersForOrganization(organizationId: number) {
    return this.members.listForOrganization(organizationId);
  }

  addMember(input: { organizationId: number; userId: number; role?: OrganizationMemberRole }) {
    return this.members.addMember(input);
  }

  removeMember(organizationId: number, userId: number) {
    return this.members.removeMember(organizationId, userId);
  }
}

export type { MembershipRepositoryLike };
export default MembershipService;
export { resolveMembershipService } from "./resolveMembershipService.ts";
