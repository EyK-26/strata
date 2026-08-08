import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { OrganizationRecord } from "./types";

class OrganizationPolicy extends Policy {
  override create(): boolean {
    return true;
  }

  override update(_user: AuthUser | null, _organization: OrganizationRecord): boolean {
    return true;
  }

  override delete(
    user: AuthUser | null,
    organization: OrganizationRecord,
  ): boolean {
    if (organization.slug !== "protected-org") {
      return true;
    }

    return user?.role === "admin";
  }
}

export default OrganizationPolicy;
