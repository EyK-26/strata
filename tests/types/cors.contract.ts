/** Compiled by check; intentionally not executed as a runtime test. */
import type { CorsOptions as RootCorsOptions } from "@getstrata/core";
import {
  type CorsConfig,
  type CorsOptions,
  createCorsMiddleware,
  resolveCorsConfig,
} from "@getstrata/core/http/corsMiddleware";
import type { Middleware } from "@getstrata/core/http/middleware";

export function corsContractFixtures(): void {
  const names = ["Idempotency-Key"] as const;
  const options: CorsOptions & RootCorsOptions = { additionalAllowedHeaders: names };
  const middleware: Middleware = createCorsMiddleware(options);
  const config: CorsConfig = resolveCorsConfig(options);
  void middleware;
  void config;
  // @ts-expect-error Header names are strings, not arbitrary metadata.
  createCorsMiddleware({ additionalAllowedHeaders: [42] });
  // @ts-expect-error A comma-separated setting belongs to env, not the typed array API.
  createCorsMiddleware({ additionalAllowedHeaders: "X-Key" });
  // @ts-expect-error null is not an explicit header policy.
  createCorsMiddleware({ additionalAllowedHeaders: null });
}
