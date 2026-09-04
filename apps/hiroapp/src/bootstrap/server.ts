import { createWebServer } from "@getstrata/bootstrap/web/server";
import { APP_PORT_CONFIG_KEY } from "./config.ts";
import { createApp } from "./createApp.ts";

const { context, routes } = await createApp();
const port = Number(context.config.get(APP_PORT_CONFIG_KEY) ?? process.env.PORT ?? 3000);

createWebServer({
  port,
  routes,
  publicDir: "./public",
});

console.log(`${process.env.APP_NAME ?? "HiroApp"} listening on http://localhost:${port}`);
