import { pullFlash, withFlashClear } from "./flashSession";
import type { Middleware } from "./middleware";
import { currentRequestMeta, runWithRequestMeta } from "./requestMetaContext";

function createFlashMiddleware(options: import("./flashSession").FlashSessionOptions): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const flash = pullFlash(request, options);
    const meta = currentRequestMeta();

    return await runWithRequestMeta({ ...meta, request, flash }, async () => {
      const response = await next();

      if (flash) {
        return withFlashClear(response, options);
      }

      return response;
    });
  };
}

export { createFlashMiddleware };
