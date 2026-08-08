import { resolveApplicationDependencies } from "../../bootstrap/applicationRegistry";
import type { OrganizationMemberRole } from "../../modules/organization/memberTypes";
import { ForbiddenError } from "../errors/http";
import { hasMinimumOrgRole, isGlobalAdmin, resolveUserId } from "./accessControl";
import { type AuthUser, currentAuthUser } from "./authContext";
import { membershipRepository } from "./membershipContext";

class MembershipService {
  async listOrganizationIdsForUser(userId: number): Promise<number[]> {
    const memberships = await membershipRepository.listForUser(userId);
    return memberships.map((membership) => membership.organization_id);
  }

  async getOrgRole(userId: number, organizationId: number): Promise<OrganizationMemberRole | null> {
    const membership = await membershipRepository.findMembership(userId, organizationId);
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
    await membershipRepository.addMember({
      organizationId,
      userId,
      role: "owner",
    });
  }

  listMembersForOrganization(organizationId: number) {
    return membershipRepository.listForOrganization(organizationId);
  }

  addMember(input: { organizationId: number; userId: number; role?: OrganizationMemberRole }) {
    return membershipRepository.addMember(input);
  }

  removeMember(organizationId: number, userId: number) {
    return membershipRepository.removeMember(organizationId, userId);
  }
}

function resolveMembershipService(): MembershipService {
  const dependencies = resolveApplicationDependencies();

  if (dependencies.container.has("core.membership")) {
    return dependencies.container.resolve<MembershipService>("core.membership");
  }

  return new MembershipService();
}

export default MembershipService;
export { resolveMembershipService };
