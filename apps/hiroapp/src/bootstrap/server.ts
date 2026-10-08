import "./preload.ts";
import {
  installGracefulShutdownSignals,
  LifecycleCoordinator,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { bootstrapApp, createAppServer } from "./createApp.ts";
import { closeDatabase } from "./database.ts";

const { routes, config, context } = await bootstrapApp();
const lifecycle = new LifecycleCoordinator();
let server: ReturnType<typeof createAppServer>;
try {
  server = createAppServer(routes, config.port, lifecycle);
} catch (error) {
  try {
    await context.dispose();
  } finally {
    await closeDatabase();
  }
  throw error;
}
console.log(`Listening on http://localhost:${server.port} (APP_URL ${config.appUrl})`);

lifecycle.register("providers:drain", () => context.drain(), "drain");
lifecycle.register("providers:flush", () => context.flush(), "flush");
lifecycle.register("providers:close", () => context.dispose(), "close");
lifecycle.register("database", closeDatabase, "close");
installGracefulShutdownSignals(undefined, lifecycle);
