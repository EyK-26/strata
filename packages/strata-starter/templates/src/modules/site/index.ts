import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core";
import { pingDatabase } from "../../bootstrap/database.ts";
import { plainText, renderPage } from "../../lib/view.ts";

const siteModule: AppModule = {
  name: "site",
  order: 1,
  webRoutes({ kernel }) {
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
  },
};

export default siteModule;
