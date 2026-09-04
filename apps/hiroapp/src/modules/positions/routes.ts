import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { ForbiddenError, NotFoundError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { PositionResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { loadCandidatePosition, loadPositionWithApplications } from "../../lib/loaders.ts";
import { isCandidate, isRecruiter } from "../../lib/roles.ts";
import { serializeApplication } from "../../lib/serialize.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import { applications } from "../applications/repository.ts";
import { positions } from "./repository.ts";
import { CreatePositionRequest, PositionIndexRequest } from "./requests.ts";

export function positionRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/positions": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "positions", "view");
        const query = new PositionIndexRequest().validate(request);
        let departmentId = query.department || undefined;
        if (isRecruiter(user.role_id)) {
          const seat = await User.newFromRecord(user).position().first();
          if (!seat) {
            throw new ForbiddenError("Recruiter has no assigned position.");
          }
          departmentId = Number(seat.get("department_id"));
        }
        const rows = await positions.hiring({
          search: isRecruiter(user.role_id) ? undefined : query.search,
          departmentId,
        });
        const payload = await Promise.all(
          rows.map(async (position) => ({
            ...new PositionResource(position).toArray(),
            applications: (await applications.forPosition(position.id)).map((row) =>
              serializeApplication(row),
            ),
          })),
        );
        return jsonResponse(payload);
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "positions", "create");
        const payload = await new CreatePositionRequest().validate(request);
        const departmentId = isRecruiter(user.role_id)
          ? Number(
              (await User.newFromRecord(user).position().first())?.get("department_id") ??
                payload.department_id,
            )
          : payload.department_id;
        const created = await positions.create({
          user_id: null,
          department_id: departmentId,
          grade_id: payload.pay_grade,
          name: payload.name,
          description: payload.description,
          hiring: true,
          start_date: payload.start_date ? new Date(payload.start_date) : null,
          end_date: payload.end_date ? new Date(payload.end_date) : null,
        });
        return jsonResponse({ message: "succes", id: created.id });
      }),
    },
    "/api/positions/all": {
      GET: wrapApi(dependencies, async (request) => {
        await requireCurrentUser(request);
        return jsonResponse(await positions.distinctNames());
      }),
    },
    "/api/positions-dep/:department": {
      GET: wrapApi(dependencies, async (request) => {
        await requireCurrentUser(request);
        const departmentId = parsePositiveIntParam(routeParams(request).department, "department");
        const rows = await positions.hiringInDepartment(departmentId);
        return jsonResponse(rows.map((row) => ({ name: row.name, id: Number(row.id) })));
      }),
    },
    "/api/positions/:id": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await authorize(request, "positions", "view");
            const id = Number(position.id);
            if (isCandidate(user.role_id)) {
              const detail = await loadCandidatePosition(id);
              if (!detail) throw new NotFoundError("Position not found.");
              return jsonResponse(detail);
            }
            return jsonResponse(await loadPositionWithApplications(id));
          },
        ),
      ),
    },
    "/api/positions/:id/delete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "positions", "delete");
            const id = Number(position.id);
            await applications.deleteForPosition(id);
            await position.delete();
            return new Response("success", {
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          },
        ),
      ),
    },
    "/api/positions/:id/restore": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          async (id) => {
            const position = await Position.onlyTrashed().where({ id }).first();
            if (!position) {
              throw new NotFoundError("No deleted position to restore.");
            }
            return position;
          },
          async (request, position) => {
            await authorize(request, "positions", "delete");
            await position.restore();
            return jsonResponse({ restored: true, id: Number(position.id) });
          },
        ),
      ),
    },
  };
}
