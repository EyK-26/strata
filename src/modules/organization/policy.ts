import { isGlobalAdmin } from "../../core/auth/accessControl";
import type { AuthUser } from "../../core/auth/authContext";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
} from "../../core/auth/membershipContext";
import { Policy } from "../../core/auth/policy";
import { guestCanViewResource } from "../../core/security/publicReads";
import type { OrganizationRecord } from "./types";

class OrganizationPolicy extends Policy {
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
