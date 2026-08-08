import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
} from "../../core/auth/membershipContext";
import { isGlobalAdmin } from "../../core/auth/accessControl";
import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { ProjectRecord } from "./types";

class ProjectPolicy extends Policy {
  override create(user: AuthUser | null): boolean {
    return user !== null;
  }

  override view(user: AuthUser | null, project: ProjectRecord): boolean {
    if (!user) {
      return false;
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
