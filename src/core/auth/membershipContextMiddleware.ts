import type { Middleware } from "../http/middleware";
import { type MembershipSnapshot, runWithMembershipSnapshot } from "./membershipContext";
export function createMembershipContextMiddleware(snapshot: MembershipSnapshot): Middleware {
  return async (_request, next) => await runWithMembershipSnapshot(snapshot, next);
}
