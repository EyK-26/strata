import type TokenService from "../../modules/user/tokenService";
import { currentAuthUser } from "../auth/authContext";
import { ForbiddenError } from "../errors/http";
import type { Middleware } from "./middleware";

function createRequireAbilityMiddleware(tokenService: TokenService) {
  return (ability: string): Middleware => {
    return async (_request: Request, next: () => Promise<Response>) => {
      const user = currentAuthUser();

      try {
        tokenService.requireAbility(user, ability);
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return Response.json({ error: error.message }, { status: error.status });
        }

        throw error;
      }

      return await next();
    };
  };
}

export { createRequireAbilityMiddleware };
