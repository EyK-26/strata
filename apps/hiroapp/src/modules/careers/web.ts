import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWeb, wrapWebAuthenticated } from "../../http/wrap.ts";
import { CareerPosting } from "../../models/CareerPosting.ts";
import { Position } from "../../models/Position.ts";
import { careerService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function careerWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/careers": {
      GET: wrapWeb(dependencies, async (request) =>
        renderPage(request, "careers/index", {
          postings: await careerService.listPublic(),
        }),
      ),
    },
    "/careers/:id": {
      GET: wrapWeb(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) =>
            renderPage(request, "careers/show", {
              posting: await careerService.showPublic(posting),
            }),
        ),
      ),
    },
    "/positions/:id/career": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await careerService.publish(actor, position, {
              expires_at: fields.expires_at || null,
              publish_at: fields.publish_at || null,
            });
            return redirectResponse(returnTo(fields, `/positions/${position.id}`));
          },
        ),
      ),
    },
    "/careers/:id/unpublish": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await careerService.unpublish(actor, posting);
            return redirectResponse(returnTo(fields, `/positions/${posting.get("position_id")}`));
          },
        ),
      ),
    },
    "/careers/:id/expire": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await careerService.expire(actor, posting);
            return redirectResponse(returnTo(fields, `/positions/${posting.get("position_id")}`));
          },
        ),
      ),
    },
    "/careers/:id/pin": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await careerService.pin(actor, posting);
            return redirectResponse(returnTo(fields, `/positions/${posting.get("position_id")}`));
          },
        ),
      ),
    },
    "/careers/:id/unpin": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => CareerPosting.findOrFail(id),
          async (request, posting) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await careerService.unpin(actor, posting);
            return redirectResponse(returnTo(fields, `/positions/${posting.get("position_id")}`));
          },
        ),
      ),
    },
  };
}
