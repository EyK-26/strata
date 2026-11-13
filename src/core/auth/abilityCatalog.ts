const MEMBER_ABILITIES = [
  "profile:read",
  "auth:tokens:read",
  "auth:tokens:write",
  "auth:tokens:delete",
] as const;

const ADMIN_ABILITIES = [
  ...MEMBER_ABILITIES,
  "webhooks:read",
  "webhooks:write",
  "audit:read",
  "audit:export",
] as const;

const PLATFORM_ADMIN_ABILITIES = ["*"] as const;

function resolveAbilitiesForRole(role: string | null | undefined): string[] {
  if (role === "admin") {
    return [...PLATFORM_ADMIN_ABILITIES];
  }

  return [...MEMBER_ABILITIES];
}

export { ADMIN_ABILITIES, MEMBER_ABILITIES, PLATFORM_ADMIN_ABILITIES, resolveAbilitiesForRole };
