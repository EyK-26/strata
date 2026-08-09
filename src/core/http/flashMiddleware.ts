import { pullFlash, withFlashClear } from "./flashSession";
import type { Middleware } from "./middleware";
import { currentRequestMeta, runWithRequestMeta } from "./requestMetaContext";

function createFlashMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const flash = pullFlash(request);
    const meta = currentRequestMeta();

    return await runWithRequestMeta({ ...meta, request, flash }, async () => {
      const response = await next();

      if (flash) {
        return withFlashClear(response);
      }

      return response;
    });
  };
}

export { createFlashMiddleware };
