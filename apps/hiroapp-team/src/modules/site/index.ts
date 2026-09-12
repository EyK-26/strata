import type { AppModule } from "@getstrata/bootstrap/contracts";
import { withErrorHandling } from "@getstrata/core/http/response";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { getSql, pingDatabase } from "../../bootstrap/database.ts";
import { plainText, renderPage } from "../../lib/view.ts";

// Schema existence only. Empty or tenant-filtered notes still look healthy.
async function schemaReady(): Promise<boolean> {
  try {
    await runWithMigrationBypass(async () => {
      await getSql().unsafe("SELECT 1 FROM notes LIMIT 1");
    });
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
