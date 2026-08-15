import type { AuthUser } from "@getstrata/core";
import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
  isGlobalAdmin,
} from "@getstrata/core";
import { Policy } from "@getstrata/core/auth/policy";
import { guestCanViewResource } from "@getstrata/core/security/publicReads";
import type { CommentRecord } from "./types";

interface CommentWithScope extends CommentRecord {
  organization_id?: number;
}

class CommentPolicy extends Policy {
  constructor() {
    super();
  }

  override create(user: AuthUser | null): boolean {
    return user !== null;
  }

  override view(user: AuthUser | null, comment: CommentWithScope): boolean {
    if (!user) {
      return guestCanViewResource();
    }

    if (comment.organization_id === undefined) {
      return isGlobalAdmin(user);
    }

    return isGlobalAdmin(user) || hasOrgMembership(comment.organization_id);
  }

  override update(user: AuthUser | null, comment: CommentWithScope): boolean {
    if (!user) {
      return false;
    }

    if (comment.organization_id === undefined) {
      return isGlobalAdmin(user);
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return hasMinimumOrgRoleInContext(comment.organization_id, "member");
  }

  override delete(user: AuthUser | null, comment: CommentWithScope): boolean {
    if (!user) {
      return false;
    }

    if (comment.organization_id === undefined) {
      return isGlobalAdmin(user);
    }

    if (isGlobalAdmin(user)) {
      return true;
    }

    return (
      hasMinimumOrgRoleInContext(comment.organization_id, "member") ||
      hasOrgMembership(comment.organization_id)
    );
  }
}

export default CommentPolicy;
