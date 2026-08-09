import type { Middleware } from "./middleware";

interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}

function resolveCorsConfig(): CorsConfig {
  return {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "*")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    allowedMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Request-Id",
      "X-Tenant-Id",
      "X-Authenticated-User-Id",
      "X-Authenticated-User-Role",
      "If-Match",
      "If-None-Match",
    ],
    maxAgeSeconds: 86_400,
  };
}

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
  const corsConfig = resolveCorsConfig();
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

export { createCorsMiddleware, resolveCorsConfig };
