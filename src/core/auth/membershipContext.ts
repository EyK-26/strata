import { AsyncLocalStorage } from "node:async_hooks";
import type { OrganizationMemberRole } from "../../modules/organization/memberTypes";
import OrganizationMemberRepository from "../../modules/organization/memberRepository";
import { isGlobalAdmin, resolveUserId } from "./accessControl";
import { currentAuthUser } from "./authContext";

type MembershipContext = {
  organizationIds: number[];
  rolesByOrganizationId: Map<number, OrganizationMemberRole>;
};

const membershipContext = new AsyncLocalStorage<MembershipContext>();
const membershipRepository = new OrganizationMemberRepository();

async function runWithMembershipContext<T>(
  callback: () => T | Promise<T>,
): Promise<T | Promise<T>> {
  const user = currentAuthUser();

  if (!user || isGlobalAdmin(user)) {
    return await callback();
  }

  const memberships = await membershipRepository.listForUser(resolveUserId(user));
  const context: MembershipContext = {
    organizationIds: memberships.map((membership) => membership.organization_id),
    rolesByOrganizationId: new Map(
      memberships.map((membership) => [membership.organization_id, membership.role]),
    ),
  };

  return await membershipContext.run(context, callback);
}

function currentOrgRole(organizationId: number): OrganizationMemberRole | null {
  return membershipContext.getStore()?.rolesByOrganizationId.get(organizationId) ?? null;
}

function hasOrgMembership(organizationId: number): boolean {
  return currentOrgRole(organizationId) !== null;
}

function currentOrganizationIds(): number[] {
  return membershipContext.getStore()?.organizationIds ?? [];
}

function hasMinimumOrgRole(
  organizationId: number,
  minimum: OrganizationMemberRole,
): boolean {
  const role = currentOrgRole(organizationId);

  if (!role) {
    return false;
  }

  const ranks: Record<OrganizationMemberRole, number> = {
    member: 1,
    admin: 2,
    owner: 3,
  };

  return ranks[role] >= ranks[minimum];
}

export {
  currentOrgRole,
  currentOrganizationIds,
  hasMinimumOrgRole,
  hasOrgMembership,
  membershipContext,
  membershipRepository,
  runWithMembershipContext,
};

export type { MembershipContext };
