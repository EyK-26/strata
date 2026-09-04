import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { OfferTemplate } from "../../models/OfferTemplate.ts";
import { offerService, serializeOffer } from "../offers/service.ts";
import {
  CreateOfferTemplateRequest,
  FromTemplateRequest,
  UpdateOfferTemplateRequest,
} from "./requests.ts";
import { offerTemplateService, serializeOfferTemplate } from "./service.ts";

export function offerTemplateRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/offer-templates": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse(await offerTemplateService.list(actor));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const payload = await new CreateOfferTemplateRequest().validate(request);
        const created = await offerTemplateService.create(actor, payload);
        return jsonResponse(serializeOfferTemplate(created));
      }),
    },
    "/api/offer-templates/:id/update": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => OfferTemplate.findOrFail(id),
          async (request, template) => {
            const actor = await requireCurrentUser(request);
            const payload = await new UpdateOfferTemplateRequest().validate(request);
            return jsonResponse(
              serializeOfferTemplate(await offerTemplateService.update(actor, template, payload)),
            );
          },
        ),
      ),
    },
    "/api/offer-templates/:id/delete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => OfferTemplate.findOrFail(id),
          async (request, template) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await offerTemplateService.remove(actor, template));
          },
        ),
      ),
    },
    "/api/applications/:id/offers/from-template": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const payload = await new FromTemplateRequest().validate(request);
            const template = await OfferTemplate.findOrFail(payload.template_id);
            const materialized = await offerTemplateService.materialize(actor, template, payload);
            const created = await offerService.create(actor, application, {
              salary: materialized.salary,
              notes: materialized.notes,
              starts_on: payload.starts_on,
            });
            return jsonResponse(serializeOffer(created));
          },
        ),
      ),
    },
  };
}
