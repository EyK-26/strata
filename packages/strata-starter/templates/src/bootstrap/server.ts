import { createWebServer } from "@getstrata/bootstrap";
import "./preload.ts";
import { migrate } from "../db/migrate.ts";
import { Router } from "../lib/router.ts";
import { registerRoutes } from "../routes.ts";
import { loadConfig } from "./config.ts";
import { closeDatabase, pingDatabase } from "./database.ts";

const config = loadConfig();

await migrate();

const router = new Router();
registerRoutes(router);

const server = createWebServer({
  port: config.port,
  publicDir: "./public",
  handle: (request) => router.handle(request),
});

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
