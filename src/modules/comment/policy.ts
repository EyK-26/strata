import {
  hasMinimumOrgRole as hasMinimumOrgRoleInContext,
  hasOrgMembership,
} from "../../core/auth/membershipContext";
import { isGlobalAdmin } from "../../core/auth/accessControl";
import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { CommentRecord } from "./types";

interface CommentWithScope extends CommentRecord {
  organization_id?: number;
}

class CommentPolicy extends Policy {
  override create(user: AuthUser | null): boolean {
    return user !== null;
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
