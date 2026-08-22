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

interface AbilityCatalog {
  member: readonly string[];
  admin: readonly string[];
  resolveForRole(role: string | null | undefined): string[];
}

function resolveAbilitiesForRole(role: string | null | undefined): string[] {
  if (role === "admin") {
    return [...PLATFORM_ADMIN_ABILITIES];
  }

  return [...MEMBER_ABILITIES];
}

const defaultCatalog: AbilityCatalog = {
  member: MEMBER_ABILITIES,
  admin: ADMIN_ABILITIES,
  resolveForRole: resolveAbilitiesForRole,
};

let catalog: AbilityCatalog = defaultCatalog;

function configureAbilityCatalog(next: AbilityCatalog): void {
  catalog = next;
}

function abilityCatalog(): AbilityCatalog {
  return catalog;
}

export type { AbilityCatalog };
export {
  ADMIN_ABILITIES,
  abilityCatalog,
  configureAbilityCatalog,
  MEMBER_ABILITIES,
  PLATFORM_ADMIN_ABILITIES,
  resolveAbilitiesForRole,
};
