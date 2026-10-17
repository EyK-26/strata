import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { ForbiddenError, HttpError } from "@getstrata/core/errors/http";
import { errorResponse } from "@getstrata/core/http/response";
import type { AbilityChecker } from "../auth/abilityChecker";
import { isViewsEnabled } from "../runtime/frontendMode";
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

          // Admission denials retain their message/status-only public contract.
          return errorResponse(new HttpError(error.status, error.message));
        }

        throw error;
      }

      return await next();
    };
  };
}

export { createRequireAbilityMiddleware };
