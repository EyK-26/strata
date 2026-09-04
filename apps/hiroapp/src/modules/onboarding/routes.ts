import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { OnboardingItem } from "../../models/OnboardingItem.ts";
import { CreateOnboardingRequest } from "./requests.ts";
import { onboardingService, serializeOnboardingItem } from "./service.ts";

export function onboardingRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications/:id/onboarding": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await onboardingService.listForApplication(actor, application));
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
            const payload = await new CreateOnboardingRequest().validate(request);
            const created = await onboardingService.create(actor, application, payload);
            return jsonResponse(serializeOnboardingItem(created));
          },
        ),
      ),
    },
    "/api/onboarding/:id/complete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => OnboardingItem.findOrFail(id),
          async (request, item) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(
              serializeOnboardingItem(await onboardingService.complete(actor, item)),
            );
          },
        ),
      ),
    },
  };
}
