import { isGlobalAdmin } from "@getstrata/core/auth/accessControl";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
} from "@getstrata/core/auth/membershipContext";
import { Policy } from "@getstrata/core/auth/policy";
import { guestCanViewResource } from "@getstrata/core/security/publicReads";
import type { AttachmentWithScope } from "./service";

class AttachmentPolicy extends Policy {
  constructor() {
    super();
  }

  override create(user: AuthUser | null): boolean {
    return user !== null;
  }

  override view(user: AuthUser | null, attachment: AttachmentWithScope): boolean {
    if (!user) {
      return guestCanViewResource();
    }

    if (attachment.organization_id === undefined) {
      return isGlobalAdmin(user);
    }

    return isGlobalAdmin(user) || hasOrgMembership(attachment.organization_id);
  }

  override delete(user: AuthUser | null, attachment: AttachmentWithScope): boolean {
    if (!user) {
      return false;
    }

    if (attachment.organization_id === undefined) {
      return isGlobalAdmin(user);
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(attachment.organization_id, "member");
  }

  override update(_user: AuthUser | null, _attachment: AttachmentWithScope): boolean {
    return false;
  }
}

export default AttachmentPolicy;
