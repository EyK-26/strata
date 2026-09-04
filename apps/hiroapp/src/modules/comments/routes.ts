import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Position } from "../../models/Position.ts";
import { CreateCommentRequest } from "../skills/requests.ts";
import { commentService } from "./service.ts";

export function commentRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications/:id/comments": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            await authorize(request, "applications", "view", application);
            const rows = await commentService.forApplication(application);
            return jsonResponse(rows.map((row) => row.toArray()));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const user = await requireCurrentUser(request);
            await authorize(request, "applications", "view", application);
            const payload = await new CreateCommentRequest().validate(request);
            const created = await commentService.addToApplication(user, application, payload.body);
            return jsonResponse(created.toArray());
          },
        ),
      ),
    },
    "/api/positions/:id/comments": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            await authorize(request, "positions", "view");
            const rows = await commentService.forPosition(position);
            return jsonResponse(rows.map((row) => row.toArray()));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await requireCurrentUser(request);
            await authorize(request, "positions", "view");
            const payload = await new CreateCommentRequest().validate(request);
            const created = await commentService.addToPosition(user, position, payload.body);
            return jsonResponse(created.toArray());
          },
        ),
      ),
    },
  };
}
