import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Department } from "../../models/Department.ts";
import { DepartmentNameRequest } from "./requests.ts";
import { departmentService, serializeDepartment } from "./service.ts";

export function departmentRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/departments": {
      GET: wrapApi(dependencies, async (request) => {
        await requireCurrentUser(request);
        const rows = await departmentService.ordered();
        return jsonResponse(rows.map(serializeDepartment));
      }),
      POST: wrapApi(dependencies, async (request) => {
        await authorize(request, "departments", "create");
        const payload = await new DepartmentNameRequest().validate(request);
        const created = await departmentService.create(payload.name);
        return jsonResponse(serializeDepartment(created));
      }),
    },
    "/api/departments/:id": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            await authorize(request, "departments", "update");
            const payload = await new DepartmentNameRequest().validate(request);
            const updated = await departmentService.rename(Number(department.id), payload.name);
            return jsonResponse(serializeDepartment(updated));
          },
        ),
      ),
    },
    "/api/departments/:id/freeze": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const actor = await authorize(request, "departments", "update");
            return jsonResponse(
              serializeDepartment(await departmentService.freeze(actor, Number(department.id))),
            );
          },
        ),
      ),
    },
    "/api/departments/:id/unfreeze": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const actor = await authorize(request, "departments", "update");
            return jsonResponse(
              serializeDepartment(await departmentService.unfreeze(actor, Number(department.id))),
            );
          },
        ),
      ),
    },
    "/api/departments/:id/delete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            await authorize(request, "departments", "delete");
            return jsonResponse(await departmentService.remove(Number(department.id)));
          },
        ),
      ),
    },
  };
}
