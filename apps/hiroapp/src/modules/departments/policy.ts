import { Policy } from "@getstrata/core/auth/policy";
import { isAdmin } from "../../lib/roles.ts";
import type { UserRecord } from "../users/table.ts";

function roleId(user: unknown) {
  return typeof user === "object" && user && "role_id" in user
    ? Number((user as UserRecord).role_id)
    : 0;
}

export class DepartmentPolicy extends Policy {
  view(user?: unknown) {
    return Boolean(user);
  }

  create(user?: unknown) {
    return isAdmin(roleId(user));
  }

  update(user?: unknown) {
    return isAdmin(roleId(user));
  }

  delete(user?: unknown) {
    return isAdmin(roleId(user));
  }
}
