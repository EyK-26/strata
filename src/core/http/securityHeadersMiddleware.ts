import type { ContentSecurityPolicyOptions } from "@getstrata/core/http/contentSecurityPolicy";
import {
  configureContentSecurityPolicy,
  generateCspNonce,
  resolveContentSecurityPolicy,
} from "@getstrata/core/http/contentSecurityPolicy";
import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { appEnv } from "../runtime/appKeyPrefix";
import type { Middleware } from "./middleware";

function createSecurityHeadersMiddleware(options: ContentSecurityPolicyOptions = {}): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const nonce = generateCspNonce();
    const existing = currentRequestMeta();

    return await runWithRequestMeta(
      {
        ...existing,
        request: existing.request ?? request,
        cspNonce: nonce,
      },
      async () => {
        const response = await next();
        const headers = new Headers(response.headers);

        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-Frame-Options", "DENY");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set("X-XSS-Protection", "0");
        headers.set(
          "Content-Security-Policy",
          resolveContentSecurityPolicy(response, { ...options, nonce }),
        );

        if (appEnv() === "production") {
          headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },
    );
  };
}

export type { ContentSecurityPolicyOptions };
export { configureContentSecurityPolicy, createSecurityHeadersMiddleware };
