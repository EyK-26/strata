import type { MembershipLookup } from "../contracts/membership";
import MembershipService from "./membershipServiceImplementation";
/** Composition supplies the live lookup; no current-application selection. */
export function resolveMembershipService(members: MembershipLookup): MembershipService {
  return new MembershipService(members);
}
