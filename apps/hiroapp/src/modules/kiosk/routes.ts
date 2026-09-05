import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { kioskService } from "./service.ts";

export function kioskRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/kiosk/scorecards": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse({ data: await kioskService.list(actor) });
      }),
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const payload = (await request.json()) as {
          interview_id: number;
          overall_score: number;
          recommendation: string;
          notes?: string | null;
        };
        return jsonResponse(await kioskService.save(actor, payload));
      }),
    },
    "/api/kiosk/sync": {
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse(await kioskService.sync(actor));
      }),
    },
  };
}
