import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http/response";
import { getSql, pingDatabase } from "../../bootstrap/database.ts";
import { plainText, renderPage } from "../../lib/view.ts";

// Proves the database answers and the schema is migrated. Point it at a table your app owns.
async function schemaReady(): Promise<boolean> {
  try {
    await getSql().unsafe("SELECT 1 FROM notes LIMIT 1");
    return true;
  } catch {
    return false;
  }
}

const siteModule: AppModule = {
  name: "site",
  order: 1,
  routes({ kernel }) {
    return {
      "/health": kernel.wrap(
        "api",
        withErrorHandling(async () => {
          const ok = (await pingDatabase()) && (await schemaReady());
          return plainText(ok ? "ok" : "degraded", ok ? 200 : 503);
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
