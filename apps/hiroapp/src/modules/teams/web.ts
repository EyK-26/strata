import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { canManageTeam } from "../../lib/staffTeam.ts";
import { Department } from "../../models/Department.ts";
import { serializeDepartment } from "../departments/service.ts";
import { teamService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function teamWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/departments/:id": {
      GET: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const actor = await requireCurrentUser(request);
            denyUnless(isStaff(actor.role_id), "Staff only.");
            const departmentId = Number(department.id);
            const [members, invitations, canManage] = await Promise.all([
              teamService.listMembers(actor, departmentId),
              teamService.listInvitations(actor, departmentId),
              canManageTeam(actor, departmentId),
            ]);
            return renderPage(request, "departments/show", {
              department: serializeDepartment(department.toObject()),
              members,
              invitations,
              can_manage: canManage,
            });
          },
        ),
      ),
    },
    "/departments/:id/invitations": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await teamService.invite(
              actor,
              Number(department.id),
              fields.email ?? "",
              fields.role || undefined,
            );
            return redirectResponse(returnTo(fields, `/departments/${department.id}`));
          },
        ),
      ),
    },
    "/departments/:id/members/:userId/remove": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const params = routeParams(request);
        const departmentId = parsePositiveIntParam(params.id, "id");
        const userId = parsePositiveIntParam(params.userId, "userId");
        const { fields } = await parseFormBody(request);
        await teamService.removeMember(actor, departmentId, userId);
        return redirectResponse(returnTo(fields, `/departments/${departmentId}`));
      }),
    },
  };
}
