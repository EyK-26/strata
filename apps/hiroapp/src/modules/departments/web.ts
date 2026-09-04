import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { authorize } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { serializeNamed } from "../../lib/serialize.ts";
import { departmentService } from "./service.ts";

export function departmentWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/departments": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "departments", "view");
        const rows = await departmentService.ordered();
        return renderPage(request, "departments/index", {
          departments: rows.map(serializeNamed),
        });
      }),
    },
    "/departments/create": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "departments", "create");
        return renderPage(request, "departments/create", {});
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "departments", "create");
        const { fields } = await parseFormBody(request);
        await departmentService.create(fields.name ?? "");
        return redirectResponse("/departments");
      }),
    },
  };
}
