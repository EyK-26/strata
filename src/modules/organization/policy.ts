import type { AuthUser } from "@getstrata/core";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
  isGlobalAdmin,
} from "@getstrata/core";
import { Policy } from "@getstrata/core/auth/policy";
import { guestCanViewResource } from "@getstrata/core/security/publicReads";
import type { OrganizationRecord } from "./types";

class OrganizationPolicy extends Policy {
  constructor() {
    super();
  }

  override create(user: AuthUser | null): boolean {
    return user !== null;
  }

  override view(user: AuthUser | null, organization: OrganizationRecord): boolean {
    if (!user) {
      return guestCanViewResource();
    }

    return isGlobalAdmin(user) || hasOrgMembership(organization.id);
  }

  override update(user: AuthUser | null, organization: OrganizationRecord): boolean {
    if (!user) {
      return false;
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(organization.id, "admin");
  }

  override delete(user: AuthUser | null, organization: OrganizationRecord): boolean {
    if (organization.slug === "protected-org") {
      return user?.role === "admin";
    }

    if (!user) {
      return false;
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(organization.id, "owner");
  }
}

export default OrganizationPolicy;
