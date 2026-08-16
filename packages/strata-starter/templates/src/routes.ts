import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { createRouteKernel } from "@getstrata/bootstrap/web/routing";
import { withErrorHandling } from "@getstrata/core";
import { pingDatabase } from "./bootstrap/database.ts";
import { plainText, renderPage } from "./lib/view.ts";

export function buildRoutes(dependencies: AppDependencies): AppRouteMap {
  const kernel = createRouteKernel(dependencies);

  return {
    "/": kernel.wrapWeb(async () =>
      renderPage("home.eta", {
        layout: {
          title: "Home",
          description: "A new Strata application",
        },
      }),
    ),
    "/health": kernel.wrapWeb(
      withErrorHandling(async () => {
        const dbOk = await pingDatabase();
        return plainText(dbOk ? "ok" : "degraded");
      }),
    ),
  };
}
