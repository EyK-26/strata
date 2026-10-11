import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http/response";
import { CORE_VIEW_RENDERER_TOKEN, textResponse } from "@getstrata/core/view";
import { pingDatabase } from "../../bootstrap/database.ts";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  webRoutes({ kernel, dependencies }) {
    const views = dependencies.container.resolve(CORE_VIEW_RENDERER_TOKEN);
    return {
      "/": kernel.wrapWeb(async (request) =>
        views.renderHtmx(
          "home.eta",
          {
            layout: {
              title: "Home",
              description: "A new Strata application",
            },
          },
          { request },
        ),
      ),
      "/health": kernel.wrapWeb(
        withErrorHandling(async () => {
          const dbOk = await pingDatabase();
          return textResponse(dbOk ? "ok" : "degraded", { status: dbOk ? 200 : 503 });
        }),
      ),
    };
  },
};

export default siteModule;
