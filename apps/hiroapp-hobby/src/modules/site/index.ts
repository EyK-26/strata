import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http/response";
import { pingDatabase } from "../../bootstrap/database.ts";
import { plainText, renderPage } from "../../lib/view.ts";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  routes({ kernel }) {
    return {
      "/health": kernel.wrap(
        "api",
        withErrorHandling(async () => {
          const dbOk = await pingDatabase();
          return plainText(dbOk ? "ok" : "degraded");
        }),
      ),
    };
  },
  webRoutes({ kernel }) {
    return {
      "/": kernel.wrapWeb(async (request) =>
        renderPage(
          "home.eta",
          {
            layout: {
              title: "Welcome",
              description:
                "Welcome to your Strata app. Restyle views/home.eta and public/assets/site.css.",
            },
          },
          request,
        ),
      ),
    };
  },
};

export default siteModule;
