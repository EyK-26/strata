import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { authorize } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Department } from "../../models/Department.ts";
import { departmentService, serializeDepartment } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function departmentWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/departments": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "departments", "view");
        const rows = await departmentService.ordered();
        return renderPage(request, "departments/index", {
          departments: rows.map(serializeDepartment),
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
    "/departments/:id/freeze": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const actor = await authorize(request, "departments", "update");
            const { fields } = await parseFormBody(request);
            await departmentService.freeze(actor, Number(department.id));
            return redirectResponse(returnTo(fields, "/departments"));
          },
        ),
      ),
    },
    "/departments/:id/unfreeze": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const actor = await authorize(request, "departments", "update");
            const { fields } = await parseFormBody(request);
            await departmentService.unfreeze(actor, Number(department.id));
            return redirectResponse(returnTo(fields, "/departments"));
          },
        ),
      ),
    },
  };
}
