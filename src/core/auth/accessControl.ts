import { currentAuthUser, type AuthUser } from "./authContext";
import { ForbiddenError } from "../errors/http";
import type { OrganizationMemberRole } from "../../modules/organization/memberTypes";

const ROLE_RANK: Record<OrganizationMemberRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

function isGlobalAdmin(user: AuthUser | null): boolean {
  return user?.role === "admin";
}

function hasMinimumOrgRole(
  role: OrganizationMemberRole | null | undefined,
  minimum: OrganizationMemberRole,
): boolean {
  if (!role) {
    return false;
  }

  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

function requireAuthenticatedUser(): AuthUser {
  const user = currentAuthUser();

  if (!user) {
    throw new ForbiddenError("Authentication required.");
  }

  return user;
}

function resolveUserId(user: AuthUser): number {
  const userId = typeof user.id === "number" ? user.id : Number(user.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ForbiddenError("Invalid authenticated user.");
  }

  return userId;
}

export {
  hasMinimumOrgRole,
  isGlobalAdmin,
  requireAuthenticatedUser,
  resolveUserId,
  ROLE_RANK,
};
