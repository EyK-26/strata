import { withErrorHandling } from "@getstrata/core";
import { pingDatabase } from "./bootstrap/database.ts";
import type { Router } from "./lib/router.ts";
import { plainText, renderPage } from "./lib/view.ts";

export function registerRoutes(router: Router) {
  router.get("/", async () =>
    renderPage("home.eta", {
      layout: {
        title: "Home",
        description: "A new Strata application",
      },
    }),
  );

  router.get(
    "/health",
    withErrorHandling(async () => {
      const dbOk = await pingDatabase();
      return plainText(dbOk ? "ok" : "degraded");
    }),
  );
}
