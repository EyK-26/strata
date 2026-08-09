import type { AuthUser } from "./authContext";

interface AbilityChecker {
  tokenCan(user: AuthUser | null, ability: string): boolean;
  requireAbility(user: AuthUser | null, ability: string): void;
}

export type { AbilityChecker };
