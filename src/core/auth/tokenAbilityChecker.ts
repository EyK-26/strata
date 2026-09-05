import { ForbiddenError } from "@getstrata/core/errors/http";
import type { AbilityChecker } from "./abilityChecker";
import type { AuthUser } from "./authContext";

function tokenCan(user: AuthUser | null, ability: string): boolean {
  if (!user) {
    return false;
  }

  const abilities = user.abilities ?? [];
  return abilities.includes("*") || abilities.includes(ability);
}

function createTokenAbilityChecker(): AbilityChecker {
  return {
    tokenCan,
    requireAbility(user, ability) {
      if (!tokenCan(user, ability)) {
        throw new ForbiddenError(`Missing ability: ${ability}`);
      }
    },
  };
}

export { createTokenAbilityChecker, tokenCan };
