import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { OfferTemplate } from "../../models/OfferTemplate.ts";
import { offerTemplateService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

function salaryField(value: string | undefined) {
  return value ? Number(value) : null;
}

export function offerTemplateWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/offer-templates": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return renderPage(request, "offer-templates/index", {
          templates: await offerTemplateService.list(actor),
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        await offerTemplateService.create(actor, {
          name: fields.name || "",
          body: fields.body || "",
          salary: salaryField(fields.salary),
        });
        return redirectResponse(returnTo(fields, "/offer-templates"));
      }),
    },
    "/offer-templates/:id/update": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => OfferTemplate.findOrFail(id),
          async (request, template) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await offerTemplateService.update(actor, template, {
              name: Object.hasOwn(fields, "name") ? fields.name : undefined,
              body: Object.hasOwn(fields, "body") ? fields.body : undefined,
              salary: Object.hasOwn(fields, "salary") ? salaryField(fields.salary) : undefined,
            });
            return redirectResponse(returnTo(fields, "/offer-templates"));
          },
        ),
      ),
    },
    "/offer-templates/:id/delete": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => OfferTemplate.findOrFail(id),
          async (request, template) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await offerTemplateService.remove(actor, template);
            return redirectResponse(returnTo(fields, "/offer-templates"));
          },
        ),
      ),
    },
  };
}
