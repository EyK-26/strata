import { assertResourceInCurrentTenant } from "@getstrata/core/auth/membershipScope";
import { resolveMembershipService } from "@getstrata/core/auth/membershipService";
import { NotFoundError } from "@getstrata/core/errors/http";
import type OrganizationRepository from "../organization/repository";
import type { OrganizationRecord } from "../organization/types";
import type UserRepository from "./repository";

interface CurrentOrganizationResource {
  organization_id: number | null;
  organization: { id: number; name: string; slug: string } | null;
}

interface CurrentOrganizationWriter {
  assign(userId: number, organizationId: number): Promise<void>;
  assignIfMissing(userId: number, organizationId: number): Promise<void>;
}

function toCurrentOrganizationResource(
  organization: OrganizationRecord | null,
  organizationId: number | null,
): CurrentOrganizationResource {
  if (!organization) {
    return { organization_id: organizationId, organization: null };
  }

  return {
    organization_id: organization.id,
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
  };
}

class CurrentOrganizationService implements CurrentOrganizationWriter {
  constructor(
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
  ) {}

  async assign(userId: number, organizationId: number): Promise<void> {
    await this.users.updateByIdOrThrow(userId, { current_organization_id: organizationId });
  }

  async assignIfMissing(userId: number, organizationId: number): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);

    if (user.current_organization_id) {
      return;
    }

    await this.assign(userId, organizationId);
  }

  async clearIfCurrent(userId: number, organizationId: number): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user || user.current_organization_id !== organizationId) {
      return;
    }

    const remaining = await resolveMembershipService().listOrganizationIdsForUser(userId);
    const next = remaining.find((id) => id !== organizationId);

    await this.users.updateByIdOrThrow(userId, { current_organization_id: next ?? null });
  }

  async currentForUser(userId: number): Promise<CurrentOrganizationResource> {
    const user = await this.users.findByIdOrThrow(userId);
    const organizationId = user.current_organization_id ?? null;

    if (!organizationId) {
      return toCurrentOrganizationResource(null, null);
    }

    const organization = await this.organizations.findById(organizationId);
    return toCurrentOrganizationResource(organization, organizationId);
  }

  async resolveHomePath(userId: number, requested = "/organizations"): Promise<string> {
    if (requested !== "/organizations" && requested !== "/") {
      return requested;
    }

    const current = await this.currentForUser(userId);
    return current.organization ? `/organizations/${current.organization.id}` : "/organizations";
  }

  async switchForUser(
    userId: number,
    organizationId: number,
  ): Promise<CurrentOrganizationResource> {
    const organization = await this.organizations.findById(organizationId);

    if (!organization) {
      throw new NotFoundError(`Organization ${organizationId} not found.`);
    }

    assertResourceInCurrentTenant(organization.tenant_id, "Organization", organizationId);
    await resolveMembershipService().requireOrgAccess(organizationId, "member");
    await this.assign(userId, organization.id);

    return toCurrentOrganizationResource(organization, organization.id);
  }
}

const currentOrganizationServiceToken = "user.currentOrganizationService";

export type { CurrentOrganizationResource, CurrentOrganizationWriter };
export {
  CurrentOrganizationService,
  currentOrganizationServiceToken,
  toCurrentOrganizationResource,
};
