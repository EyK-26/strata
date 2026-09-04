import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { catalogService } from "./service.ts";

export function catalogRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/catalog": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        if (!isStaff(actor.role_id)) {
          throw new ForbiddenError();
        }
        return jsonResponse(await catalogService.snapshot());
      }),
    },
  };
}
