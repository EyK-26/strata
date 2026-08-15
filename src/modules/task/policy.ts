import type { AuthUser } from "@getstrata/core";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
  isGlobalAdmin,
} from "@getstrata/core";
import { Policy } from "@getstrata/core/auth/policy";
import { guestCanViewResource } from "@getstrata/core/security/publicReads";
import type { TaskWithProjectRecord } from "./types";

function organizationIdForTask(task: TaskWithProjectRecord): number | null {
  return task.project?.organization_id ?? null;
}

class TaskPolicy extends Policy {
  override create(user: AuthUser | null): boolean {
    return user !== null;
  }

  override view(user: AuthUser | null, task: TaskWithProjectRecord): boolean {
    if (!user) {
      return guestCanViewResource();
    }

    const organizationId = organizationIdForTask(task);

    if (organizationId === null) {
      return isGlobalAdmin(user);
    }

    return isGlobalAdmin(user) || hasOrgMembership(organizationId);
  }

  override update(user: AuthUser | null, task: TaskWithProjectRecord): boolean {
    if (!user) {
      return false;
    }

    const organizationId = organizationIdForTask(task);

    if (organizationId === null) {
      return isGlobalAdmin(user);
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(organizationId, "member");
  }

  override delete(user: AuthUser | null, task: TaskWithProjectRecord): boolean {
    if (!user) {
      return false;
    }

    const organizationId = organizationIdForTask(task);

    if (organizationId === null) {
      return isGlobalAdmin(user);
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(organizationId, "admin");
  }
}

export default TaskPolicy;
export { organizationIdForTask };
