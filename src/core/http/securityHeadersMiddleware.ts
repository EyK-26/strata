import type { Middleware } from "./middleware";

function createSecurityHeadersMiddleware(): Middleware {
  return async (_request: Request, next: () => Promise<Response>) => {
    const response = await next();
    const headers = new Headers(response.headers);

    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-XSS-Protection", "0");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export { createSecurityHeadersMiddleware };
