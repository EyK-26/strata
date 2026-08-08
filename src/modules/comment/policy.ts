import type { AuthUser } from "../../core/auth/authContext";
import { Policy } from "../../core/auth/policy";
import type { CommentRecord } from "./types";

class CommentPolicy extends Policy {
  override create(_user: AuthUser | null): boolean {
    return true;
  }

  override update(user: AuthUser | null, _comment: CommentRecord): boolean {
    return user?.role === "admin" || user?.role === "member";
  }

  override delete(user: AuthUser | null, _comment: CommentRecord): boolean {
    return user?.role === "admin" || user?.role === "member";
  }
}

export default CommentPolicy;
