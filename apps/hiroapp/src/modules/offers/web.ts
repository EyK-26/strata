import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Offer } from "../../models/Offer.ts";
import { OfferTemplate } from "../../models/OfferTemplate.ts";
import { offerTemplateService } from "../offerTemplates/service.ts";
import { offerService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function offerWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/offers": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            let salary = Number(fields.salary);
            let notes = fields.notes || null;
            if (fields.template_id) {
              const template = await OfferTemplate.findOrFail(Number(fields.template_id));
              const materialized = await offerTemplateService.materialize(actor, template, {
                salary: fields.salary ? Number(fields.salary) : null,
                notes: fields.notes || null,
              });
              salary = materialized.salary;
              notes = materialized.notes;
            }
            const created = await offerService.create(actor, application, {
              salary,
              starts_on: fields.starts_on || null,
              notes,
            });
            if (fields.send === "1") {
              const model = await Offer.findOrFail(created.id);
              await offerService.send(actor, model);
            }
            return redirectResponse(returnTo(fields, `/applications/${application.id}`));
          },
        ),
      ),
    },
    "/offers/:id/send": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await offerService.send(actor, offer);
            return redirectResponse(
              returnTo(fields, `/applications/${offer.get("application_id")}`),
            );
          },
        ),
      ),
    },
    "/offers/:id/withdraw": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await offerService.withdraw(actor, offer);
            return redirectResponse(
              returnTo(fields, `/applications/${offer.get("application_id")}`),
            );
          },
        ),
      ),
    },
    "/offers/:id/accept": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await offerService.accept(actor, offer);
            return redirectResponse(
              returnTo(fields, `/applications/${offer.get("application_id")}`),
            );
          },
        ),
      ),
    },
    "/offers/:id/decline": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await offerService.decline(actor, offer);
            return redirectResponse(
              returnTo(fields, `/applications/${offer.get("application_id")}`),
            );
          },
        ),
      ),
    },
  };
}
