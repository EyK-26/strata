import type { MembershipLookup, OrganizationMemberRole } from "../contracts/membership";
import { createAsyncContextStore } from "../runtime/asyncContextStore";
import { isGlobalAdmin, resolveUserId } from "./accessControl";
import type { AuthUser } from "./authContext";

type MembershipSnapshot = readonly Readonly<{
  organization_id: number;
  role: OrganizationMemberRole;
}>[];
type MembershipContext = {
  organizationIds: number[];
  rolesByOrganizationId: Map<number, OrganizationMemberRole>;
};
const membershipContext = createAsyncContextStore<MembershipContext>(
  "@getstrata/membershipContext",
);
async function loadMembershipSnapshot(
  lookup: MembershipLookup,
  user: AuthUser | null,
): Promise<MembershipSnapshot> {
  if (!user || isGlobalAdmin(user)) return Object.freeze([]);
  const rows = await lookup.listForUser(resolveUserId(user));
  return Object.freeze(
    rows.map((row) => Object.freeze({ organization_id: row.organization_id, role: row.role })),
  );
}
function runWithMembershipSnapshot<T>(snapshot: MembershipSnapshot, callback: () => T): T {
  return membershipContext.run(
    {
      organizationIds: snapshot.map((row) => row.organization_id),
      rolesByOrganizationId: new Map(snapshot.map((row) => [row.organization_id, row.role])),
    },
    callback,
  );
}
async function runWithMembershipContext<T>(
  lookup: MembershipLookup,
  user: AuthUser | null,
  callback: () => T | Promise<T>,
): Promise<T> {
  return await runWithMembershipSnapshot(await loadMembershipSnapshot(lookup, user), callback);
}
function currentOrgRole(organizationId: number): OrganizationMemberRole | null {
  return membershipContext.getStore()?.rolesByOrganizationId.get(organizationId) ?? null;
}
function hasOrgMembership(organizationId: number): boolean {
  return currentOrgRole(organizationId) !== null;
}
function currentOrganizationIds(): number[] {
  return [...(membershipContext.getStore()?.organizationIds ?? [])];
}
function hasMinimumOrgRole(organizationId: number, minimum: OrganizationMemberRole): boolean {
  const role = currentOrgRole(organizationId);
  if (!role) return false;
  const ranks: Record<OrganizationMemberRole, number> = { member: 1, admin: 2, owner: 3 };
  return ranks[role] >= ranks[minimum];
}

export type { MembershipContext, MembershipSnapshot };
export {
  currentOrganizationIds,
  currentOrgRole,
  hasMinimumOrgRole,
  hasOrgMembership,
  loadMembershipSnapshot,
  membershipContext,
  runWithMembershipContext,
  runWithMembershipSnapshot,
};
