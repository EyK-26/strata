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
  server = createAppServer(
    routes,
    config.port,
    lifecycle,
    config.hostname ? { hostname: config.hostname } : undefined,
  );
} catch (error) {
  const failures: unknown[] = [];
  for (const cleanup of [() => context.dispose(), closeDatabase]) {
    try {
      await cleanup();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length)
    throw new AggregateError([error, ...failures], "Application startup and cleanup failed.", {
      cause: error,
    });
  throw error;
}
console.log(`Listening on ${server.url.origin} (APP_URL ${config.appUrl})`);

lifecycle.register("providers:drain", () => context.drain(), "drain");
lifecycle.register("providers:flush", () => context.flush(), "flush");
lifecycle.register("providers:close", () => context.dispose(), "close");
lifecycle.register("database", closeDatabase, "close");
installGracefulShutdownSignals(undefined, lifecycle);
