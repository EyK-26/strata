import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi, wrapPublic } from "../../http/wrap.ts";
import { CareerPosting } from "../../models/CareerPosting.ts";
import { Position } from "../../models/Position.ts";
import { PublishCareerRequest } from "./requests.ts";
import { careerService, serializeCareerPosting } from "./service.ts";

export function careerRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/careers": {
      GET: wrapPublic(async () => jsonResponse(await careerService.listPublic())),
    },
    "/api/careers/:id": {
      GET: wrapPublic(
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (_request, posting) => jsonResponse(await careerService.showPublic(posting)),
        ),
      ),
    },
    "/api/positions/:id/career": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await careerService.forPosition(actor, position));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            const payload = await new PublishCareerRequest().validate(request);
            const created = await careerService.publish(actor, position, payload);
            return jsonResponse(serializeCareerPosting(created));
          },
        ),
      ),
    },
    "/api/careers/:id/unpublish": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(
              serializeCareerPosting(await careerService.unpublish(actor, posting)),
            );
          },
        ),
      ),
    },
    "/api/careers/:id/expire": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeCareerPosting(await careerService.expire(actor, posting)));
          },
        ),
      ),
    },
    "/api/careers/:id/pin": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeCareerPosting(await careerService.pin(actor, posting)));
          },
        ),
      ),
    },
    "/api/careers/:id/unpin": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeCareerPosting(await careerService.unpin(actor, posting)));
          },
        ),
      ),
    },
  };
}
