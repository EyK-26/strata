import { CORE_TRACING_RUNTIME_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { createBodySizeLimitMiddleware } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { createCorsMiddleware, resolveCorsConfig } from "@getstrata/core/http/corsMiddleware";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { createMetricsMiddleware } from "@getstrata/core/http/metricsMiddleware";
import type { Middleware } from "@getstrata/core/http/middleware";
import { requestIdMiddleware } from "@getstrata/core/http/middleware";
import { createJsonErrorMiddleware, createWebErrorMiddleware } from "@getstrata/core/http/response";
import { createSecurityHeadersMiddleware } from "@getstrata/core/http/securityHeadersMiddleware";
import { createRequestLoggingMiddleware } from "@getstrata/core/logging/requestLoggingMiddleware";
import { createTracingMiddleware } from "@getstrata/core/tracing/tracingMiddleware";
import { CORE_WEB_ERROR_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import { CORE_CONFIG_TOKEN, CSRF_TARGET_ORIGIN_CONFIG_KEY } from "./config";
import type { AppDependencies } from "./contracts";
import { HTTP_PERSISTENCE_OPTIONS } from "./httpPersistence";
import type { HttpPersistenceOptions } from "./persistenceContracts";
import { resolveLoginRateLimit, resolveRegisterRateLimit } from "./rateLimit";

/** Snapshot response configuration once, independently of route wrapping and persistence. */
function resolveHttpResponseSettings(
  dependencies: AppDependencies,
  http: HttpPersistenceOptions | undefined,
) {
  const config = dependencies.container.has(CORE_CONFIG_TOKEN)
    ? dependencies.container.resolve(CORE_CONFIG_TOKEN)
    : undefined;
  const features =
    http?.features ?? config?.get<HttpPersistenceOptions["features"]>("http.features");
  const emailVerificationRequired = features?.emailVerificationRequired ?? false;
  const viewsEnabled = features?.viewsEnabled ?? false;
  const publicReadsEnabled = features?.publicReadsEnabled ?? false;
  const etagEnabled = features?.etagEnabled ?? true;
  const policy =
    http?.responsePolicy ??
    config?.get<HttpPersistenceOptions["responsePolicy"]>("http.responsePolicy");
  if (policy?.cors) resolveCorsConfig(policy.cors);
  const responsePolicy = Object.freeze({
    cors: policy?.cors
      ? {
          allowedOrigins: [...(policy.cors.allowedOrigins ?? [])],
          additionalAllowedHeaders: [...(policy.cors.additionalAllowedHeaders ?? [])],
        }
      : undefined,
    securityHeaders: policy?.securityHeaders ?? {
      production: http?.production ?? true,
      frontendMode: viewsEnabled ? ("server-htmx" as const) : ("api" as const),
    },
    maxBodyBytes: policy?.maxBodyBytes ?? 1_048_576,
    rateLimitPerMinute: policy?.rateLimitPerMinute ?? 120,
    namespace: policy?.namespace ?? "strata",
    trustForwardedFor: policy?.trustForwardedFor ?? false,
    loginRateLimit: Object.freeze({ ...(policy?.loginRateLimit ?? resolveLoginRateLimit()) }),
    registerRateLimit: Object.freeze({
      ...(policy?.registerRateLimit ?? resolveRegisterRateLimit()),
    }),
  });
  const targetOrigin = dependencies.container.has(CORE_CONFIG_TOKEN)
    ? dependencies.container.resolve(CORE_CONFIG_TOKEN).get<string>(CSRF_TARGET_ORIGIN_CONFIG_KEY)
    : undefined;
  const configuredCsrfMiddleware = createCsrfMiddleware({ targetOrigin, ...http?.csrf });
  return {
    emailVerificationRequired,
    viewsEnabled,
    publicReadsEnabled,
    etagEnabled,
    responsePolicy,
    configuredCsrfMiddleware,
  };
}

function createHttpResponseMiddleware(
  dependencies: AppDependencies,
  settings: ReturnType<typeof resolveHttpResponseSettings>,
  errorFormat: "json" | "web",
): Middleware[] {
  return [
    createCorsMiddleware(settings.responsePolicy.cors),
    createSecurityHeadersMiddleware(settings.responsePolicy.securityHeaders),
    createBodySizeLimitMiddleware(settings.responsePolicy.maxBodyBytes),
    ...(dependencies.container.has(CORE_TRACING_RUNTIME_TOKEN)
      ? [createTracingMiddleware(dependencies.container.resolve(CORE_TRACING_RUNTIME_TOKEN))]
      : []),
    createMetricsMiddleware(),
    createRequestLoggingMiddleware(settings.responsePolicy.trustForwardedFor),
    requestIdMiddleware,
    // Commit and deferred listeners finish inside this boundary, before telemetry records the result.
    errorFormat === "json"
      ? createJsonErrorMiddleware()
      : createWebErrorMiddleware({
          enabled: settings.viewsEnabled,
          production: dependencies.container.has(HTTP_PERSISTENCE_OPTIONS)
            ? (dependencies.container.resolve<HttpPersistenceOptions>(HTTP_PERSISTENCE_OPTIONS)
                .production ?? true)
            : true,
          render: dependencies.container.has(CORE_WEB_ERROR_VIEW_TOKEN)
            ? dependencies.container.resolve(CORE_WEB_ERROR_VIEW_TOKEN)
            : undefined,
        }),
  ];
}

export { createHttpResponseMiddleware, resolveHttpResponseSettings };
