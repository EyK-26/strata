import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { NotFoundError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { ApplicationResource, mergeResource, PositionResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { loadCandidatePosition, loadPositionWithApplications } from "../../lib/loaders.ts";
import { isCandidate } from "../../lib/roles.ts";
import { Department } from "../../models/Department.ts";
import { Position } from "../../models/Position.ts";
import { applications } from "../applications/repository.ts";
import { positions } from "./repository.ts";
import { CreatePositionRequest, PositionIndexRequest, UpdatePositionRequest } from "./requests.ts";
import { positionService } from "./service.ts";

export function positionRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/positions": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "positions", "view");
        const query = new PositionIndexRequest().validate(request);
        const rows = await positionService.listHiringForActor(user, {
          search: query.search,
          department_id: query.department || undefined,
        });
        const payload = await Promise.all(
          rows.map(async (position) =>
            mergeResource(new PositionResource(position), {
              applications: (await applications.forPosition(position.id)).map((row) =>
                new ApplicationResource(row).toArray(),
              ),
            }),
          ),
        );
        return jsonResponse(payload);
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "positions", "create");
        const payload = await new CreatePositionRequest().validate(request);
        const created = await positionService.create(user, payload);
        return jsonResponse({ message: "success", id: created.id });
      }),
    },
    "/api/positions/all": {
      GET: wrapApi(dependencies, async (request) => {
        await requireCurrentUser(request);
        return jsonResponse(await positions.distinctNames());
      }),
    },
    "/api/positions-dep/:department": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "department",
          (id) => Department.findOrFail(id),
          async (request, department) => {
            await requireCurrentUser(request);
            const rows = await positions.hiringInDepartment(Number(department.id));
            return jsonResponse(rows.map((row) => ({ name: row.name, id: Number(row.id) })));
          },
        ),
      ),
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
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "update");
            const payload = await new UpdatePositionRequest().validate(request);
            const updated = await positionService.update(actor, position, payload);
            return jsonResponse(new PositionResource(updated).toArray());
          },
        ),
      ),
    },
    "/api/positions/:id/close": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "update");
            const updated = await positionService.close(actor, position);
            return jsonResponse(new PositionResource(updated).toArray());
          },
        ),
      ),
    },
    "/api/positions/:id/reopen": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await authorize(request, "positions", "update");
            const updated = await positionService.reopen(actor, position);
            return jsonResponse(new PositionResource(updated).toArray());
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
            const actor = await authorize(request, "positions", "delete");
            return jsonResponse(await positionService.remove(actor, position));
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
            const actor = await authorize(request, "positions", "delete");
            const restored = await positionService.restore(actor, position);
            return jsonResponse({ restored: true, id: Number(restored.id) });
          },
        ),
      ),
    },
  };
}
