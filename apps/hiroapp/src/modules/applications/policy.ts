import { Policy } from "@getstrata/core/auth/policy";
import { isCandidate, isStaff } from "../../lib/roles.ts";
import type { UserRecord } from "../users/table.ts";
import type { ApplicationRecord } from "./table.ts";

function asUser(user: unknown): UserRecord | null {
  return typeof user === "object" && user && "role_id" in user ? (user as UserRecord) : null;
}

export class ApplicationPolicy extends Policy {
  view(user?: unknown, resource?: unknown) {
    const actor = asUser(user);
    if (!actor) return false;
    if (isStaff(actor.role_id)) return true;
    const application = resource as ApplicationRecord | undefined;
    return Boolean(application && Number(application.user_id) === Number(actor.id));
  }

  create(user?: unknown) {
    const actor = asUser(user);
    return Boolean(actor && isCandidate(actor.role_id));
  }

  update(user?: unknown) {
    const actor = asUser(user);
    return Boolean(actor && isStaff(actor.role_id));
  }

  delete(user?: unknown, resource?: unknown) {
    const actor = asUser(user);
    if (!actor) return false;
    if (isStaff(actor.role_id)) return true;
    const application = resource as ApplicationRecord | undefined;
    return Boolean(application && Number(application.user_id) === Number(actor.id));
  }
}
