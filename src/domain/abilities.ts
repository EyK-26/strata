const MEMBER_ABILITIES = [
  "organizations:read",
  "projects:read",
  "projects:create",
  "tasks:read",
  "tasks:create",
  "comments:read",
  "comments:create",
  "attachments:read",
  "attachments:create",
  "auth:tokens:read",
  "auth:tokens:write",
] as const;

const ADMIN_ABILITIES = [
  ...MEMBER_ABILITIES,
  "organizations:create",
  "organizations:update",
  "organizations:delete",
  "projects:update",
  "projects:delete",
  "tasks:update",
  "tasks:delete",
  "comments:update",
  "comments:delete",
  "attachments:delete",
  "webhooks:read",
  "webhooks:write",
  "audit:read",
] as const;

const PLATFORM_ADMIN_ABILITIES = ["*"] as const;

function resolveAbilitiesForRole(role: string | null | undefined): string[] {
  if (role === "admin") {
    return [...PLATFORM_ADMIN_ABILITIES];
  }

  return [...MEMBER_ABILITIES];
}

export { ADMIN_ABILITIES, MEMBER_ABILITIES, PLATFORM_ADMIN_ABILITIES, resolveAbilitiesForRole };
