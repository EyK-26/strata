import { isGlobalAdmin } from "@getstrata/core/auth/accessControl";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
} from "@getstrata/core/auth/membershipContext";
import { Policy } from "@getstrata/core/auth/policy";
import { guestCanViewResource } from "@getstrata/core/security/publicReads";
import type { ProjectRecord } from "./types";

class ProjectPolicy extends Policy {
  override create(user: AuthUser | null): boolean {
    return user !== null;
  }

  override view(user: AuthUser | null, project: ProjectRecord): boolean {
    if (!user) {
      return guestCanViewResource();
    }

    return isGlobalAdmin(user) || hasOrgMembership(project.organization_id);
  }

  override update(user: AuthUser | null, project: ProjectRecord): boolean {
    if (!user) {
      return false;
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(project.organization_id, "member");
  }

  override delete(user: AuthUser | null, project: ProjectRecord): boolean {
    if (!user) {
      return false;
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(project.organization_id, "admin");
  }
}

export default ProjectPolicy;
