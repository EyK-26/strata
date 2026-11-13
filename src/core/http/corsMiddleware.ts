import type { Middleware } from "./middleware";

interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}

/** Explicit application-owned origin and request-header policy. Omitted origins grant no cross-origin access. */
interface CorsOptions {
  additionalAllowedHeaders?: readonly string[];
  allowedOrigins?: readonly string[];
}

function additionalHeaders(options: CorsOptions): string[] {
  const supplied =
    options.additionalAllowedHeaders === undefined ? [] : options.additionalAllowedHeaders;
  if (!Array.isArray(supplied)) {
    throw new TypeError("CORS additionalAllowedHeaders must be an array of header names.");
  }
  const names: unknown[] = [...supplied];
  return names.map((name) => {
    // HTTP field-name token syntax. A wildcard is never an application-approved name.
    if (typeof name !== "string" || name === "*" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      throw new TypeError(
        "CORS additional headers must be explicit valid HTTP header names; wildcards are not allowed.",
      );
    }
    return name;
  });
}

function resolveCorsConfig(options: CorsOptions = {}): CorsConfig {
  const extraHeaders = additionalHeaders(options);
  if (
    options.allowedOrigins !== undefined &&
    (!Array.isArray(options.allowedOrigins) ||
      options.allowedOrigins.some((origin) => typeof origin !== "string"))
  )
    throw new TypeError("CORS allowedOrigins must be an array of origins.");
  return {
    allowedOrigins: [...(options.allowedOrigins ?? [])]
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
      "X-CSRF-Token",
      ...extraHeaders,
    ].filter(
      (name, index, names) =>
        names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index,
    ),
    maxAgeSeconds: 86_400,
  };
}

function createCorsMiddleware(options: CorsOptions = {}): Middleware {
  // Reject invalid configuration before requests are admitted. Keep the caller's array private.
  const captured = resolveCorsConfig(options);
  return async (request: Request, next: () => Promise<Response>) => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request, captured),
      });
    }

    const response = await next();
    const headers = new Headers(response.headers);

    for (const [key, value] of buildCorsHeaders(request, captured)) {
      if (key === "vary") {
        const fields = (headers.get("Vary") ?? "")
          .split(",")
          .map((field) => field.trim())
          .filter(Boolean);
        if (fields.includes("*")) continue;
        if (!fields.some((field) => field.toLowerCase() === "origin")) fields.push(value);
        headers.set("Vary", fields.join(", "));
      } else {
        headers.set(key, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function buildCorsHeaders(request: Request, corsConfig: CorsConfig): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  const allowedOrigins = corsConfig.allowedOrigins;
  headers.set("Vary", "Origin");

  const allowOrigin = allowedOrigins.includes("*")
    ? "*"
    : origin && allowedOrigins.includes(origin)
      ? origin
      : null;
  if (!allowOrigin) {
    return headers;
  }

  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Access-Control-Allow-Methods", corsConfig.allowedMethods.join(", "));
  headers.set("Access-Control-Allow-Headers", corsConfig.allowedHeaders.join(", "));
  headers.set("Access-Control-Max-Age", String(corsConfig.maxAgeSeconds));
  if (allowOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return headers;
}

export type { CorsConfig, CorsOptions };
export { createCorsMiddleware, resolveCorsConfig };
