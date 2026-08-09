import { join } from "node:path";
import index from "./index.html";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";
const PORT = Number(process.env.FRONTEND_PORT ?? "5173");
const PREVIEW = process.argv.includes("--preview");
const DIST_DIRECTORY = join(import.meta.dir, "dist");

async function proxyToApi(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, API_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("host");

  return fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
    verbose: false,
  });
}

async function servePreview(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const relativePath = pathname.replace(/^\/app\/?/, "");
  const asset = Bun.file(join(DIST_DIRECTORY, relativePath));

  if (relativePath.length > 0 && (await asset.exists())) {
    return new Response(asset);
  }

  const indexFile = Bun.file(join(DIST_DIRECTORY, "index.html"));

  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response("SPA build not found. Run `bun run build`.", { status: 503 });
}

const server = Bun.serve({
  port: PORT,
  development: PREVIEW
    ? false
    : {
        hmr: true,
        console: true,
      },
  routes: {
    "/api/*": proxyToApi,
    "/health": proxyToApi,
    "/ready": proxyToApi,
    "/app": PREVIEW ? servePreview : index,
    "/app/": PREVIEW ? servePreview : index,
    "/app/*": PREVIEW ? servePreview : index,
  },
});

console.log(
  PREVIEW
    ? `SPA preview on ${server.url}app/ (proxy ${API_ORIGIN})`
    : `SPA dev server on ${server.url}app/ (proxy ${API_ORIGIN})`,
);
