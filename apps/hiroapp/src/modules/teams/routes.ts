import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { jsonResponse } from "@getstrata/core/http/response";
import { expectObject } from "@getstrata/core/http/validation";
import { bindModel } from "../../http/bind.ts";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { NamedResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { membershipsFor, resolveStaffDepartmentId } from "../../lib/staffTeam.ts";
import { Department } from "../../models/Department.ts";
import { departments } from "../departments/repository.ts";
import { teamService } from "./service.ts";

class InviteRequest extends FormRequest<{ email: string; role?: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      throw new ValidationError("The given data was invalid.", {
        email: ["The email field is required."],
      });
    }
    return {
      email,
      role: typeof body.role === "string" ? body.role : undefined,
    };
  }
}

class SwitchDepartmentRequest extends FormRequest<{ department_id: number }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const department_id = Number(body.department_id);
    if (!Number.isInteger(department_id) || department_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        department_id: ["The department id field is required."],
      });
    }
    return { department_id };
  }
}

class AddMemberRequest extends FormRequest<{ user_id: number; role?: string }> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const user_id = Number(body.user_id);
    if (!Number.isInteger(user_id) || user_id <= 0) {
      throw new ValidationError("The given data was invalid.", {
        user_id: ["The user id field is required."],
      });
    }
    return {
      user_id,
      role: typeof body.role === "string" ? body.role : undefined,
    };
  }
}

export function teamRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/users/me/departments": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const rows = await membershipsFor(user.id);
        const currentId = await resolveStaffDepartmentId(user);
        const payload = await Promise.all(
          rows.map(async (row) => {
            const department = await departments.findById(row.department_id);
            return {
              id: Number(row.id),
              role: row.role,
              current: Number(row.department_id) === currentId,
              department: department ? new NamedResource(department).toArray() : null,
            };
          }),
        );
        return jsonResponse({ current_department_id: currentId, memberships: payload });
      }),
    },
    "/api/users/me/current-department": {
      PUT: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const payload = await new SwitchDepartmentRequest().validate(request);
        const updated = await teamService.switchCurrentDepartment(user, payload.department_id);
        return jsonResponse({ current_department_id: Number(updated.current_department_id) });
      }),
    },
    "/api/users/me/invitations": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        return jsonResponse(await teamService.receivedInvitations(user));
      }),
    },
    "/api/users/me/invitations/:id/accept": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const id = Number((request as Request & { params?: { id?: string } }).params?.id ?? "");
        const membership = await teamService.acceptInvitation(user, id);
        return jsonResponse({ accepted: true, membership });
      }),
    },
    "/api/users/me/invitations/:id": {
      DELETE: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const id = Number((request as Request & { params?: { id?: string } }).params?.id ?? "");
        await teamService.declineInvitation(user, id);
        return jsonResponse({ declined: true });
      }),
    },
    "/api/departments/:id/members": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const user = await requireCurrentUser(request);
            return jsonResponse(await teamService.listMembers(user, Number(department.id)));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const user = await requireCurrentUser(request);
            const payload = await new AddMemberRequest().validate(request);
            const created = await teamService.addMember(
              user,
              Number(department.id),
              payload.user_id,
              payload.role,
            );
            return jsonResponse(created, { status: 201 });
          },
        ),
      ),
    },
    "/api/departments/:id/members/:userId": {
      DELETE: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const params = (request as Request & { params?: { id?: string; userId?: string } }).params;
        await teamService.removeMember(actor, Number(params?.id), Number(params?.userId));
        return jsonResponse({ removed: true });
      }),
    },
    "/api/departments/:id/invitations": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const user = await requireCurrentUser(request);
            return jsonResponse(await teamService.listInvitations(user, Number(department.id)));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            const user = await requireCurrentUser(request);
            const payload = await new InviteRequest().validate(request);
            const created = await teamService.invite(
              user,
              Number(department.id),
              payload.email,
              payload.role,
            );
            return jsonResponse(created, { status: 201 });
          },
        ),
      ),
    },
  };
}
