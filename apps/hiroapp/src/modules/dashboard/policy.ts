import { Policy } from "@getstrata/core/auth/policy";
import { isRecruiter } from "../../lib/roles.ts";
import type { UserRecord } from "../users/table.ts";

export class DashboardPolicy extends Policy {
  view(user?: unknown) {
    return typeof user === "object" && user && "role_id" in user
      ? isRecruiter(Number((user as UserRecord).role_id))
      : false;
  }
}
