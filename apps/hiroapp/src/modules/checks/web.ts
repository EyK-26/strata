import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { BackgroundCheck } from "../../models/BackgroundCheck.ts";
import { backgroundCheckService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function backgroundCheckWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/background-check": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await backgroundCheckService.request(actor, application, {
              vendor: fields.vendor || null,
              notes: fields.notes || null,
            });
            return redirectResponse(returnTo(fields, `/applications/${application.id}`));
          },
        ),
      ),
    },
    "/background-checks/:id/clear": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => BackgroundCheck.findOrFail(id),
          async (request, check) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await backgroundCheckService.clear(actor, check, fields.notes || null);
            return redirectResponse(
              returnTo(fields, `/applications/${check.get("application_id")}`),
            );
          },
        ),
      ),
    },
    "/background-checks/:id/flag": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => BackgroundCheck.findOrFail(id),
          async (request, check) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await backgroundCheckService.flag(actor, check, fields.notes || null);
            return redirectResponse(
              returnTo(fields, `/applications/${check.get("application_id")}`),
            );
          },
        ),
      ),
    },
    "/background-checks/:id/cancel": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => BackgroundCheck.findOrFail(id),
          async (request, check) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await backgroundCheckService.cancel(actor, check);
            return redirectResponse(
              returnTo(fields, `/applications/${check.get("application_id")}`),
            );
          },
        ),
      ),
    },
  };
}
