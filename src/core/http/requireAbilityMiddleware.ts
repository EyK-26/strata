import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { isViewsEnabled } from "../../config/frontend";
import type { AbilityChecker } from "../auth/abilityChecker";
import { requestPrefersJson } from "./contentNegotiation";
import type { Middleware } from "./middleware";

function createRequireAbilityMiddleware(abilityChecker: AbilityChecker) {
  return (ability: string): Middleware => {
    return async (request: Request, next: () => Promise<Response>) => {
      const user = currentAuthUser();

      try {
        abilityChecker.requireAbility(user, ability);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          if (isViewsEnabled() && !requestPrefersJson(request)) {
            throw error;
          }

          return Response.json({ error: error.message }, { status: error.status });
        }

        throw error;
      }

      return await next();
    };
  };
}

export { createRequireAbilityMiddleware };
