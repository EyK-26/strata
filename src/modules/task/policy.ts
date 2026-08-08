import { isGlobalAdmin } from "../../core/auth/accessControl";
import type { AuthUser } from "../../core/auth/authContext";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
} from "../../core/auth/membershipContext";
import { Policy } from "../../core/auth/policy";
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
      return true;
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
