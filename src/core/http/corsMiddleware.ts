import { appUrl } from "../runtime/appKeyPrefix";
import type { Middleware } from "./middleware";

interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}

/** Additional application-approved request headers; defaults and origins remain unchanged. */
interface CorsOptions {
  additionalAllowedHeaders?: readonly string[];
}

function additionalHeaders(options: CorsOptions): string[] {
  const configured = process.env.CORS_ADDITIONAL_ALLOWED_HEADERS?.trim();
  const supplied =
    options.additionalAllowedHeaders === undefined ? [] : options.additionalAllowedHeaders;
  if (!Array.isArray(supplied)) {
    throw new TypeError("CORS additionalAllowedHeaders must be an array of header names.");
  }
  const names: unknown[] = [
    ...(configured ? configured.split(",").map((name) => name.trim()) : []),
    ...supplied,
  ];
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

/** Unset means same-origin (`APP_URL`) only. Never default to `*`. */
function defaultAllowedOrigins(): string {
  return appUrl();
}

function resolveCorsConfig(options: CorsOptions = {}): CorsConfig {
  const extraHeaders = additionalHeaders(options);
  return {
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? defaultAllowedOrigins())
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
  resolveCorsConfig(options);
  const captured: CorsOptions = {
    additionalAllowedHeaders: [...(options.additionalAllowedHeaders ?? [])],
  };
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
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function buildCorsHeaders(request: Request, options: CorsOptions): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  const corsConfig = resolveCorsConfig(options);
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
