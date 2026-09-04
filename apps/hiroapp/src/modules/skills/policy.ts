import { Policy } from "@getstrata/core/auth/policy";
import { isCandidate, isStaff } from "../../lib/roles.ts";

class SkillPolicy extends Policy {
  override view(user: { role_id?: number } | null): boolean {
    return user !== null;
  }

  override create(user: { role_id?: number } | null): boolean {
    return user !== null && isCandidate(user.role_id ?? 0);
  }

  override update(user: { role_id?: number } | null): boolean {
    return user !== null && isStaff(user.role_id ?? 0);
  }
}

export { SkillPolicy };
