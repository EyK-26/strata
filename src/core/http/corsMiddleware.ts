import { corsConfig } from "../../config/cors";
import type { Middleware } from "./middleware";

function createCorsMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request),
      });
    }

    const response = await next();
    const headers = new Headers(response.headers);

    for (const [key, value] of buildCorsHeaders(request)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function buildCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  const allowedOrigins = corsConfig.allowedOrigins;
  const allowOrigin =
    allowedOrigins.includes("*") || (origin && allowedOrigins.includes(origin))
      ? (origin ?? "*")
      : (allowedOrigins[0] ?? "*");

  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Access-Control-Allow-Methods", corsConfig.allowedMethods.join(", "));
  headers.set("Access-Control-Allow-Headers", corsConfig.allowedHeaders.join(", "));
  headers.set("Access-Control-Max-Age", String(corsConfig.maxAgeSeconds));
  headers.set("Vary", "Origin");
  return headers;
}

export { createCorsMiddleware };
