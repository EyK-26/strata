import type { AppModule } from "@getstrata/bootstrap/contracts";
import { renderPage } from "../../lib/view.ts";

const siteModule: AppModule = {
  name: "site",
  order: 1,
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
