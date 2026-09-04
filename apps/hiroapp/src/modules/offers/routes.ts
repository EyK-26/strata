import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Offer } from "../../models/Offer.ts";
import { CreateOfferRequest } from "./requests.ts";
import { offerService, serializeOffer } from "./service.ts";

export function offerRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications/:id/offers": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await offerService.listForApplication(actor, application));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const payload = await new CreateOfferRequest().validate(request);
            const created = await offerService.create(actor, application, payload);
            return jsonResponse(serializeOffer(created));
          },
        ),
      ),
    },
    "/api/offers/:id/send": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeOffer(await offerService.send(actor, offer)));
          },
        ),
      ),
    },
    "/api/offers/:id/withdraw": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeOffer(await offerService.withdraw(actor, offer)));
          },
        ),
      ),
    },
    "/api/offers/:id/accept": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeOffer(await offerService.accept(actor, offer)));
          },
        ),
      ),
    },
    "/api/offers/:id/decline": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Offer.findOrFail(id),
          async (request, offer) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeOffer(await offerService.decline(actor, offer)));
          },
        ),
      ),
    },
  };
}
