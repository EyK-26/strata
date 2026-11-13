import "./preload.ts";
import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createAppServer } from "./createApp.ts";

// HTTP is declared before start and acquired by this application's journal.
const app = await createAppServer();
if (!app.server) throw new Error("HTTP transport did not start.");
console.log(`Listening on ${app.server.url.origin} (APP_URL ${app.config.appUrl})`);
const lifecycle = new LifecycleCoordinator();
lifecycle.register(
  "application",
  async () => {
    const result = await app.application.stop({ reason: "SIGNAL" });
    if (!result.successful) throw new Error("Application shutdown did not complete cleanly.");
  },
  "stop",
);
installGracefulShutdownSignals(undefined, lifecycle);
