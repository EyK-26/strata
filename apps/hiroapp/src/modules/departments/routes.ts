import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { NamedResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { departments } from "./repository.ts";

export function departmentRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/departments": {
      GET: wrapApi(dependencies, async (request) => {
        await requireCurrentUser(request);
        const rows = await departments.ordered();
        return jsonResponse(rows.map((row) => new NamedResource(row).toArray()));
      }),
    },
  };
}
