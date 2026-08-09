import "./preload.ts";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { bootstrapApp, createAppServer } from "./createApp.ts";
import { closeDatabase, pingDatabase } from "./database.ts";

await ensureModulesLoaded();

const { routes, config } = await bootstrapApp();

const server = createAppServer(routes, config.port);

console.log(`${config.appUrl} (port ${server.port})`);

if (!(await pingDatabase())) {
  console.warn("Warning: database ping failed.");
}

async function shutdown() {
  await closeDatabase();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
