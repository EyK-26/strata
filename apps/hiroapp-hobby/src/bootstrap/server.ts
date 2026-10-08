import "./preload.ts";
import { bootstrapApp, createAppServer } from "./createApp.ts";
import { closeDatabase } from "./database.ts";

const { routes, config, context } = await bootstrapApp();
let server: ReturnType<typeof createAppServer>;
try {
  server = createAppServer(routes, config.port);
} catch (error) {
  try {
    await context.dispose();
  } finally {
    await closeDatabase();
  }
  throw error;
}
console.log(`Listening on http://localhost:${server.port} (APP_URL ${config.appUrl})`);

let shutdownPromise: Promise<void> | undefined;
function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    server.stop();
    try {
      await context.dispose();
    } finally {
      await closeDatabase();
    }
    process.exit(0);
  })();
  return shutdownPromise;
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
