import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { jsonResponse } from "@getstrata/core/http/response";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Position } from "../../models/Position.ts";
import { CreateCommentRequest } from "../skills/requests.ts";

export function commentRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications/:id/comments": {
      GET: wrapApi(dependencies, async (request) => {
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const application = await Application.findOrFail(id);
        await authorize(request, "applications", "view", application.toObject());
        return jsonResponse((await application.comments()).map((row) => row.toArray()));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const application = await Application.findOrFail(id);
        await authorize(request, "applications", "view", application.toObject());
        const payload = await new CreateCommentRequest().validate(request);
        const created = await application.comments().create({
          user_id: user.id,
          body: payload.body,
        });
        return jsonResponse(created.toArray());
      }),
    },
    "/api/positions/:id/comments": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "positions", "view");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const position = await Position.findOrFail(id);
        return jsonResponse((await position.comments()).map((row) => row.toArray()));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        await authorize(request, "positions", "view");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const position = await Position.findOrFail(id);
        const payload = await new CreateCommentRequest().validate(request);
        const created = await position.comments().create({
          user_id: user.id,
          body: payload.body,
        });
        return jsonResponse(created.toArray());
      }),
    },
  };
}
