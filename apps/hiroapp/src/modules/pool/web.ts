import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { TalentPoolEntry } from "../../models/TalentPoolEntry.ts";
import { talentPoolService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function talentPoolWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/talent-pool": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return renderPage(request, "talent-pool/index", {
          entries: await talentPoolService.list(actor),
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        await talentPoolService.add(actor, {
          user_id: Number(fields.user_id),
          notes: fields.notes || null,
          application_id: fields.application_id ? Number(fields.application_id) : null,
        });
        return redirectResponse(returnTo(fields, "/talent-pool"));
      }),
    },
    "/talent-pool/:id/release": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => TalentPoolEntry.findOrFail(id),
          async (request, entry) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await talentPoolService.release(actor, entry);
            return redirectResponse(returnTo(fields, "/talent-pool"));
          },
        ),
      ),
    },
    "/applications/:id/talent-pool": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await talentPoolService.addFromApplication(actor, application, {
              notes: fields.notes || null,
            });
            return redirectResponse(returnTo(fields, `/applications/${application.id}`));
          },
        ),
      ),
    },
  };
}
