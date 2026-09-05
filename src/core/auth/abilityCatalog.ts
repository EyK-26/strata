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
