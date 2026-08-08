import { appConfig } from "../../config/app";
import type { Middleware } from "./middleware";

function createSecurityHeadersMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    const response = await next();
    const headers = new Headers(response.headers);

    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-XSS-Protection", "0");
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );

    if (appConfig.env === "production") {
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export { createSecurityHeadersMiddleware };
