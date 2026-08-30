import { resolveUserId } from "@getstrata/core/auth/accessControl";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { CurrentOrganizationService } from "../user/currentOrganizationService";
import UserRepository from "../user/repository";
import OrganizationRepository from "./repository";
import { personalOrganizationSlug } from "./service";

interface OrganizationSlugLookup {
  findById(id: number): Promise<{ slug: string } | null>;
}

interface CurrentOrganizationClearer {
  clearIfCurrent(userId: number, organizationId: number): Promise<void>;
}

interface RemoveOrganizationMemberDeps {
  organizations?: OrganizationSlugLookup;
  currentOrganization?: CurrentOrganizationClearer;
}

async function removeOrganizationMember(
  organizationId: number,
  targetUserId: number,
  deps: RemoveOrganizationMemberDeps = {},
): Promise<{ self: boolean }> {
  const actor = currentAuthUser();

  if (!actor) {
    throw new ForbiddenError("Authentication required.");
  }

  const actorId = resolveUserId(actor);
  const memberships = await resolveMembershipService().listMembersForOrganization(organizationId);
  const target = memberships.find((member) => member.user_id === targetUserId);

  if (!target) {
    throw new ForbiddenError("Organization membership required.");
  }

  const owners = memberships.filter((member) => member.role === "owner");
  const isLastOwner = target.role === "owner" && owners.length <= 1;
  const self = actorId === targetUserId;

  if (self) {
    await resolveMembershipService().requireOrgAccess(organizationId, "member");

    if (isLastOwner) {
      throw new ForbiddenError("Cannot leave as the last owner.");
    }

    const organizations = deps.organizations ?? new OrganizationRepository();
    const organization = await organizations.findById(organizationId);

    if (organization?.slug === personalOrganizationSlug(targetUserId)) {
      throw new ForbiddenError("Cannot leave your personal workspace.");
    }
  } else {
    await resolveMembershipService().requireOrgAccess(organizationId, "admin");

    if (isLastOwner) {
      throw new ForbiddenError("Cannot remove the last owner.");
    }
  }

  await resolveMembershipService().removeMember(organizationId, targetUserId);

  const currentOrganization =
    deps.currentOrganization ??
    new CurrentOrganizationService(new UserRepository(), new OrganizationRepository());
  await currentOrganization.clearIfCurrent(targetUserId, organizationId);

  return { self };
}

export type { RemoveOrganizationMemberDeps };
export { removeOrganizationMember };
