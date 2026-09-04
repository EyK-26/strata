import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { OnboardingItem } from "../../models/OnboardingItem.ts";
import { onboardingService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function onboardingWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/onboarding": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await onboardingService.create(actor, application, {
              title: fields.title || "",
              notes: fields.notes || null,
            });
            return redirectResponse(returnTo(fields, `/applications/${application.id}`));
          },
        ),
      ),
    },
    "/onboarding/:id/complete": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => OnboardingItem.findOrFail(id),
          async (request, item) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await onboardingService.complete(actor, item);
            return redirectResponse(
              returnTo(fields, `/applications/${item.get("application_id")}`),
            );
          },
        ),
      ),
    },
  };
}
