import type { AuthUser } from "@getstrata/core/auth/authContext";
import { type AuthReader, establishedAuthReader } from "@getstrata/core/auth/authReader";
import { hasVerifiedEmail } from "@getstrata/core/auth/emailVerification";
import type { Policy } from "@getstrata/core/auth/policy";
import {
  CORE_TRACING_RUNTIME_TOKEN,
  resolveAbilityChecker,
} from "@getstrata/core/contracts/serviceTokens";
import { createAuthorizeMiddleware } from "@getstrata/core/http/authorizeMiddleware";
import { createBodySizeLimitMiddleware } from "@getstrata/core/http/bodySizeLimitMiddleware";
import { createCorsMiddleware, resolveCorsConfig } from "@getstrata/core/http/corsMiddleware";
import { createCsrfMiddleware } from "@getstrata/core/http/csrfMiddleware";
import { createFlashMiddleware } from "@getstrata/core/http/flashMiddleware";
import { createLoginThrottleMiddleware } from "@getstrata/core/http/loginThrottleMiddleware";
import { createMemoryThrottleMiddleware } from "@getstrata/core/http/memoryThrottleMiddleware";
import { createMetricsMiddleware } from "@getstrata/core/http/metricsMiddleware";
import type { Middleware, RouteHandler } from "@getstrata/core/http/middleware";
import { requestIdMiddleware } from "@getstrata/core/http/middleware";
import { createRequireAbilityMiddleware } from "@getstrata/core/http/requireAbilityMiddleware";
import { createRequireAuthMiddleware } from "@getstrata/core/http/requireAuthMiddleware";
import { createRequireGlobalAdminMiddleware } from "@getstrata/core/http/requireGlobalAdminMiddleware";
import { createRequirePasswordConfirmMiddleware } from "@getstrata/core/http/requirePasswordConfirmMiddleware";
import { createRequireVerifiedMiddleware } from "@getstrata/core/http/requireVerifiedMiddleware";
import { createRequireWebAuthMiddleware } from "@getstrata/core/http/requireWebAuthMiddleware";
import { createJsonErrorMiddleware, createWebErrorMiddleware } from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import type { RouteModelBindingPorts } from "@getstrata/core/http/securedRouteModelBinding";
import { createSecurityHeadersMiddleware } from "@getstrata/core/http/securityHeadersMiddleware";
import { createValidateSignatureMiddleware } from "@getstrata/core/http/signedUrl";
import { createThrottleMiddleware } from "@getstrata/core/http/throttleMiddleware";
import { createRequestLoggingMiddleware } from "@getstrata/core/logging/requestLoggingMiddleware";
import { createTracingMiddleware } from "@getstrata/core/tracing/tracingMiddleware";
import { CORE_WEB_ERROR_VIEW_TOKEN } from "@getstrata/core/view/tokens";
import type { ComposedRouteHandler } from "#strata-http-route";
import {
  assertHttpHandler,
  identityModes,
  ownedHttpRoute,
  ownedPublicHttpRoute,
  scimMiddleware,
} from "#strata-http-route";
import {
  CORE_CONFIG_TOKEN,
  CORE_HTTP_CLEANUP_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  CORE_THROTTLE_QUOTA_POLICY_TOKEN,
  CSRF_TARGET_ORIGIN_CONFIG_KEY,
  REDIS_URL_CONFIG_KEY,
} from "./config";
import type { AppDependencies } from "./contracts";
import { createHttpPersistence, HTTP_PERSISTENCE_OPTIONS } from "./httpPersistence";
import { enterModuleRoutes } from "./moduleRouteMiddleware";
import type {
  BusinessRouteHandler,
  HttpPersistenceOptions,
  IdentityPolicyMode,
} from "./persistenceContracts";
import { resolveLoginRateLimit, resolveRegisterRateLimit } from "./rateLimit";

type MiddlewareGroupName = "api" | "authenticated" | "web";
type WebGuestHome = string | ((user: AuthUser) => string | Promise<string>);

class HttpKernel {
  private readonly ownedThrottles = new Set<Middleware & { dispose(): void }>();
  private disposed = false;
  private readonly emailVerificationRequired: boolean;
  private readonly viewsEnabled: boolean;
  private readonly publicReadsEnabled: boolean;
  private readonly etagEnabled: boolean;
  private readonly httpOptions: HttpPersistenceOptions | undefined;
  private readonly responsePolicy: NonNullable<HttpPersistenceOptions["responsePolicy"]>;
  private readonly configuredCsrfMiddleware: Middleware;
  private readonly responses: Readonly<Record<"json" | "web", readonly Middleware[]>>;
  private readonly persistence: ReturnType<typeof createHttpPersistence> | undefined;
  constructor(private readonly dependencies: AppDependencies) {
    const http = dependencies.container.has(HTTP_PERSISTENCE_OPTIONS)
      ? dependencies.container.resolve<HttpPersistenceOptions>(HTTP_PERSISTENCE_OPTIONS)
      : undefined;
    this.httpOptions = http;
    const config = dependencies.container.has(CORE_CONFIG_TOKEN)
      ? dependencies.container.resolve(CORE_CONFIG_TOKEN)
      : undefined;
    const features =
      http?.features ?? config?.get<HttpPersistenceOptions["features"]>("http.features");
    this.emailVerificationRequired = features?.emailVerificationRequired ?? false;
    this.viewsEnabled = features?.viewsEnabled ?? false;
    this.publicReadsEnabled = features?.publicReadsEnabled ?? false;
    this.etagEnabled = features?.etagEnabled ?? true;
    const policy =
      http?.responsePolicy ??
      config?.get<HttpPersistenceOptions["responsePolicy"]>("http.responsePolicy");
    if (policy?.cors) resolveCorsConfig(policy.cors);
    this.responsePolicy = Object.freeze({
      cors: policy?.cors
        ? {
            allowedOrigins: [...(policy.cors.allowedOrigins ?? [])],
            additionalAllowedHeaders: [...(policy.cors.additionalAllowedHeaders ?? [])],
          }
        : undefined,
      securityHeaders: policy?.securityHeaders ?? {
        production: http?.production ?? true,
        frontendMode: this.viewsEnabled ? ("server-htmx" as const) : ("api" as const),
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
    this.configuredCsrfMiddleware = createCsrfMiddleware({ targetOrigin, ...http?.csrf });
    this.responses = Object.freeze({
      json: Object.freeze(this.responseMiddleware("json")),
      web: Object.freeze(this.responseMiddleware("web")),
    });
    this.persistence = dependencies.container.has(HTTP_PERSISTENCE_OPTIONS)
      ? createHttpPersistence(
          dependencies.invoke,
          dependencies.container.resolve<HttpPersistenceOptions>(HTTP_PERSISTENCE_OPTIONS),
        )
      : undefined;
    if (dependencies.container.has(CORE_HTTP_CLEANUP_TOKEN)) {
      dependencies.container.resolve(CORE_HTTP_CLEANUP_TOKEN)(() => this.dispose());
    }
  }

  private requireFlashOptions() {
    const options = this.httpOptions?.flash;
    if (!options) throw new TypeError("Explicit flash configuration is required for web routes.");
    return options;
  }
  private requireIntendedOptions() {
    const options = this.httpOptions?.intendedUrl;
    if (!options)
      throw new TypeError(
        "Explicit intended URL cookie configuration is required for web authentication.",
      );
    return options;
  }
  routeModelBindingPorts(auth: Pick<AuthReader, "resolve">): RouteModelBindingPorts {
    const gate = this.dependencies.container.resolve(CORE_POLICY_GATE_TOKEN);
    const authorize = gate.authorize;
    return Object.freeze({
      auth,
      authorize: (...args: Parameters<RouteModelBindingPorts["authorize"]>) =>
        authorize.call(gate, ...args),
      etagEnabled: this.etagEnabled,
    });
  }

  dispose(): void {
    this.disposed = true;
    const owned = [...this.ownedThrottles];
    this.ownedThrottles.clear();
    const errors: unknown[] = [];
    for (const throttle of owned.reverse()) {
      try {
        throttle.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "HTTP throttle cleanup failed.");
  }

  /** Own custom disposable throttle middleware until this application closes. */
  ownThrottle<T extends Middleware>(throttle: T): T {
    if (this.disposed) {
      if ("dispose" in throttle && typeof throttle.dispose === "function") throttle.dispose();
      throw new Error("HTTP kernel is disposed.");
    }
    if ("dispose" in throttle && typeof throttle.dispose === "function") {
      this.ownedThrottles.add(throttle as T & { dispose(): void });
    }
    return throttle;
  }

  globalMiddleware(errorFormat: "json" | "web" = "json"): Middleware[] {
    return [...this.responses[errorFormat]];
  }

  run<TRequest extends Request>(
    request: TRequest,
    handler: BusinessRouteHandler<TRequest>,
    format: "json" | "web" = "json",
    identity?: readonly IdentityPolicyMode[],
    scim?: readonly Middleware[],
  ): Promise<Response> {
    assertHttpHandler(handler);
    const execute = this.persistence;
    if (!execute) throw new Error("Explicit HTTP persistence composition is required.");
    const outer = withMiddleware(...this.responses[format])((req: TRequest) =>
      withMiddleware(...(scim ?? []))((req: TRequest) =>
        execute(req, handler, identity, scim !== undefined),
      )(req),
    );
    return Promise.resolve(outer(request));
  }

  composed<TRequest extends Request>(
    handler: BusinessRouteHandler<TRequest>,
    format: "json" | "web",
    identity = identityModes(handler),
    scim = scimMiddleware(handler),
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    if (identity !== undefined && scim !== undefined)
      throw new TypeError("SCIM and identity operation declarations cannot be combined.");
    return ownedHttpRoute(
      handler,
      (request, work) => this.run(request, work, format, identity, scim),
      identity,
      scim,
    );
  }

  wrapIdentity<TRequest extends Request>(
    handler: BusinessRouteHandler<TRequest>,
    modes: readonly IdentityPolicyMode[] = ["identifier"],
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    if (scimMiddleware(handler) !== undefined)
      throw new TypeError("SCIM and identity operation declarations cannot be combined.");
    if (!Array.isArray(modes) || modes.some((mode) => mode !== "identifier" && mode !== "bypass"))
      throw new TypeError("Invalid identity route policy modes.");
    return this.composed(handler, "web", Object.freeze([...modes]));
  }

  wrapPasswordConfirm<TRequest extends Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const options =
      this.dependencies.container.resolve<HttpPersistenceOptions>(
        HTTP_PERSISTENCE_OPTIONS,
      ).passwordConfirmation;
    if (!options) throw new Error("Explicit password confirmation configuration is required.");
    return this.composed(
      withMiddleware(createRequirePasswordConfirmMiddleware(options))(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }
  wrapRouteMap(
    routes: Record<string, unknown>,
    middleware: readonly Middleware[],
  ): Record<string, unknown> {
    return enterModuleRoutes(routes, (callback) =>
      this.composed(
        withMiddleware(...middleware)(callback as BusinessRouteHandler),
        "json",
        identityModes(callback),
        scimMiddleware(callback),
      ),
    );
  }

  wrapScim<TRequest extends Request>(
    handler: BusinessRouteHandler<TRequest>,
    before: readonly Middleware[] = [],
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    if (identityModes(handler) !== undefined)
      throw new TypeError("SCIM and identity operation declarations cannot be combined.");
    return this.composed(handler, "json", undefined, Object.freeze([...before]));
  }

  private responseMiddleware(errorFormat: "json" | "web"): Middleware[] {
    return [
      createCorsMiddleware(this.responsePolicy.cors),
      createSecurityHeadersMiddleware(this.responsePolicy.securityHeaders),
      createBodySizeLimitMiddleware(this.responsePolicy.maxBodyBytes),
      ...(this.dependencies.container.has(CORE_TRACING_RUNTIME_TOKEN)
        ? [createTracingMiddleware(this.dependencies.container.resolve(CORE_TRACING_RUNTIME_TOKEN))]
        : []),
      createMetricsMiddleware(),
      createRequestLoggingMiddleware(this.responsePolicy.trustForwardedFor),
      requestIdMiddleware,
      // Commit and deferred listeners finish inside this boundary, before telemetry records the result.
      errorFormat === "json"
        ? createJsonErrorMiddleware()
        : createWebErrorMiddleware({
            enabled: this.viewsEnabled,
            production: this.dependencies.container.has(HTTP_PERSISTENCE_OPTIONS)
              ? (this.dependencies.container.resolve<HttpPersistenceOptions>(
                  HTTP_PERSISTENCE_OPTIONS,
                ).production ?? true)
              : true,
            render: this.dependencies.container.has(CORE_WEB_ERROR_VIEW_TOKEN)
              ? this.dependencies.container.resolve(CORE_WEB_ERROR_VIEW_TOKEN)
              : undefined,
          }),
    ];
  }

  /** Public application documents still own response policy and observation. */
  wrapPublicDocument<TRequest extends Request = Request>(
    handler: RouteHandler<TRequest>,
  ): RouteHandler<TRequest> {
    assertHttpHandler(handler);
    return ownedPublicHttpRoute(handler, (request, work) =>
      Promise.resolve(withMiddleware(...this.responses.web)(work)(request)),
    );
  }

  group(name: MiddlewareGroupName): Middleware[] {
    const auth = establishedAuthReader;

    switch (name) {
      case "authenticated":
        return [createRequireAuthMiddleware(auth)];
      case "web":
        return this.viewsEnabled
          ? [createFlashMiddleware(this.requireFlashOptions()), this.configuredCsrfMiddleware]
          : [];
      case "api": {
        const csrf = this.configuredCsrfMiddleware;

        if (!this.dependencies.container.has(CORE_CONFIG_TOKEN)) {
          return [csrf];
        }

        const quotaPolicy = this.dependencies.container.has(CORE_THROTTLE_QUOTA_POLICY_TOKEN)
          ? this.dependencies.container.resolve(CORE_THROTTLE_QUOTA_POLICY_TOKEN)
          : undefined;
        const config = this.dependencies.container.resolve(CORE_CONFIG_TOKEN);
        const redisUrl = config.get<string>(REDIS_URL_CONFIG_KEY)?.trim() ?? "";

        if (!redisUrl) {
          const maxAttempts = this.responsePolicy.rateLimitPerMinute ?? 120;

          return [
            this.ownThrottle(
              createMemoryThrottleMiddleware({
                namespace: this.responsePolicy.namespace,
                trustForwardedFor: this.responsePolicy.trustForwardedFor,
                maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 120,
                decaySeconds: 60,
                quotaPolicy,
              }),
            ),
            csrf,
          ];
        }

        const maxAttempts = this.responsePolicy.rateLimitPerMinute ?? 120;

        return [
          this.ownThrottle(
            createThrottleMiddleware({
              namespace: this.responsePolicy.namespace,
              trustForwardedFor: this.responsePolicy.trustForwardedFor,
              redisUrl,
              maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : 120,
              decaySeconds: 60,
              quotaPolicy,
            }),
          ),
          csrf,
        ];
      }
      default:
        throw new Error(`Unknown middleware group "${name}".`);
    }
  }

  wrap<TRequest extends Request = Request>(
    groups: MiddlewareGroupName | MiddlewareGroupName[],
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const names = Array.isArray(groups) ? groups : [groups];
    const middleware = names.flatMap((name) => this.group(name));
    const wrapped = middleware.length === 0 ? handler : withMiddleware(...middleware)(handler);

    if (names.includes("api")) {
      return this.composed(wrapped, "json", identityModes(handler), scimMiddleware(handler));
    }

    return this.composed(wrapped, "web", identityModes(handler), scimMiddleware(handler));
  }

  wrapApi<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrap(["api", "authenticated"], handler);
  }

  wrapWeb<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrap("web", handler);
  }

  /** Signed-in HTML users redirect to `home` instead of seeing guest pages. */
  wrapWebGuest<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
    home: WebGuestHome = "/",
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const auth = establishedAuthReader;

    const guest = this.wrapWeb<TRequest>(async (request, ports) => {
      const user = await auth.resolve(request);

      if (user) {
        if (this.emailVerificationRequired && !hasVerifiedEmail(user)) {
          return Response.redirect("/email/verify", 302);
        }

        const location = typeof home === "function" ? await home(user) : home;
        return Response.redirect(location, 302);
      }

      return handler(request, ports);
    });
    return this.composed(guest, "web", identityModes(handler), scimMiddleware(handler));
  }

  wrapWebPublicRead<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
    options: { allowAnonymous?: boolean } = {},
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    if (options.allowAnonymous ?? this.publicReadsEnabled) {
      return this.wrapWeb(handler);
    }

    return this.wrapWebAuthenticated(handler);
  }

  wrapWebAuthenticated<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrapWebAuth(handler, { verified: true });
  }

  /** Signed-in HTML without the email-verified gate (logout, verification notice). */
  wrapWebAuthenticatedAllowUnverified<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrapWebAuth(handler, { verified: false });
  }

  wrapWebVerified<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrapWebAuth(handler, { verified: true });
  }

  /** Requires a fresh signed password-confirmation cookie. */
  wrapWebPasswordConfirm<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const options =
      this.dependencies.container.resolve<HttpPersistenceOptions>(
        HTTP_PERSISTENCE_OPTIONS,
      ).passwordConfirmation;
    if (!options) throw new Error("Explicit password confirmation configuration is required.");
    return this.wrapWebAuth(
      this.composed(
        withMiddleware(createRequirePasswordConfirmMiddleware(options))(handler),
        "web",
        identityModes(handler),
        scimMiddleware(handler),
      ),
      {
        verified: true,
      },
    );
  }

  wrapWebAbility<TRequest extends Request = Request>(
    ability: string,
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const auth = establishedAuthReader;
    const abilityChecker = resolveAbilityChecker(this.dependencies.container);
    const requireAbility = createRequireAbilityMiddleware(abilityChecker, this.viewsEnabled);
    const middleware = [
      createRequireWebAuthMiddleware(auth, this.requireIntendedOptions()),
      ...this.verifiedMiddleware(),
      requireAbility(ability),
    ];

    return this.wrapWeb(
      this.composed(
        withMiddleware(...middleware)(handler),
        "web",
        identityModes(handler),
        scimMiddleware(handler),
      ),
    );
  }

  wrapWebGlobalAdmin<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const auth = establishedAuthReader;
    const middleware = [
      createRequireWebAuthMiddleware(auth, this.requireIntendedOptions()),
      ...this.verifiedMiddleware(),
      createRequireGlobalAdminMiddleware(),
    ];

    return this.wrapWeb(
      this.composed(
        withMiddleware(...middleware)(handler),
        "web",
        identityModes(handler),
        scimMiddleware(handler),
      ),
    );
  }

  wrapAuthenticated<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrap("authenticated", handler);
  }

  /** JSON routes that require a verified email. No-op when `FEATURE_EMAIL_VERIFICATION` is off. */
  wrapVerified<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const middleware = [...this.group("authenticated"), ...this.verifiedMiddleware()];

    return this.composed(
      withMiddleware(...middleware)(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }

  wrapPublicRead<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
    options: { allowAnonymous?: boolean } = {},
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    if (options.allowAnonymous ?? this.publicReadsEnabled) {
      return this.composed(handler, "json");
    }

    return this.wrapAuthenticated(handler);
  }

  wrapGlobalAdmin<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const middleware = [...this.group("authenticated"), createRequireGlobalAdminMiddleware()];

    return this.composed(
      withMiddleware(...middleware)(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }

  wrapAbility<TRequest extends Request = Request>(
    ability: string,
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const abilityChecker = resolveAbilityChecker(this.dependencies.container);
    const requireAbility = createRequireAbilityMiddleware(abilityChecker, this.viewsEnabled);
    const middleware = [...this.group("authenticated"), requireAbility(ability)];

    return this.composed(
      withMiddleware(...middleware)(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }

  wrapPolicy<TRequest extends Request = Request>(
    resource: string,
    action: keyof Policy,
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const auth = establishedAuthReader;
    const gate = this.dependencies.container.resolve(CORE_POLICY_GATE_TOKEN);

    return this.composed(
      withMiddleware(createAuthorizeMiddleware(gate, auth, resource, action))(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }

  wrapLogin<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrapThrottle(
      "login",
      this.responsePolicy.loginRateLimit ?? resolveLoginRateLimit(),
      handler,
    );
  }

  wrapSigned<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const secret =
      this.dependencies.container.resolve<HttpPersistenceOptions>(
        HTTP_PERSISTENCE_OPTIONS,
      ).signatureSecret;
    if (!secret) throw new Error("Explicit signed URL configuration is required.");
    return this.composed(
      withMiddleware(createValidateSignatureMiddleware({ secret }))(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }

  wrapRegister<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    return this.wrapThrottle(
      "register",
      this.responsePolicy.registerRateLimit ?? resolveRegisterRateLimit(),
      handler,
    );
  }

  private wrapWebAuth<TRequest extends Request = Request>(
    handler: BusinessRouteHandler<TRequest>,
    options: { verified: boolean },
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const auth = establishedAuthReader;
    const middleware = [
      createRequireWebAuthMiddleware(auth, this.requireIntendedOptions()),
      ...(options.verified ? this.verifiedMiddleware() : []),
    ];

    return this.wrapWeb(
      this.composed(
        withMiddleware(...middleware)(handler),
        "web",
        identityModes(handler),
        scimMiddleware(handler),
      ),
    );
  }

  private verifiedMiddleware(): Middleware[] {
    const auth = establishedAuthReader;
    return [
      createRequireVerifiedMiddleware(
        auth,
        this.emailVerificationRequired,
        this.requireIntendedOptions(),
      ),
    ];
  }

  private wrapThrottle<TRequest extends Request = Request>(
    scope: "login" | "register",
    rateLimit: { maxAttempts: number; decaySeconds: number },
    handler: BusinessRouteHandler<TRequest>,
  ): ComposedRouteHandler<TRequest> {
    assertHttpHandler(handler);
    const memoryKeyPrefix = scope === "login" ? "login-throttle:" : "register-throttle:";
    const redisUrl = this.dependencies.container.has(CORE_CONFIG_TOKEN)
      ? (this.dependencies.container
          .resolve(CORE_CONFIG_TOKEN)
          .get<string>(REDIS_URL_CONFIG_KEY)
          ?.trim() ?? "")
      : "";

    if (scope === "login") {
      return this.composed(
        withMiddleware(
          this.ownThrottle(
            createLoginThrottleMiddleware({
              namespace: this.responsePolicy.namespace,
              trustForwardedFor: this.responsePolicy.trustForwardedFor,
              ...(redisUrl ? { redisUrl } : {}),
              maxAttempts: rateLimit.maxAttempts,
              decaySeconds: rateLimit.decaySeconds,
            }),
          ),
        )(handler),
        "json",
        identityModes(handler),
        scimMiddleware(handler),
      );
    }

    if (redisUrl) {
      return this.composed(
        withMiddleware(
          this.ownThrottle(
            createThrottleMiddleware({
              namespace: this.responsePolicy.namespace,
              trustForwardedFor: this.responsePolicy.trustForwardedFor,
              redisUrl,
              maxAttempts: rateLimit.maxAttempts,
              decaySeconds: rateLimit.decaySeconds,
              keyPrefix: memoryKeyPrefix,
            }),
          ),
        )(handler),
        "json",
        identityModes(handler),
        scimMiddleware(handler),
      );
    }

    return this.composed(
      withMiddleware(
        this.ownThrottle(
          createMemoryThrottleMiddleware({
            namespace: this.responsePolicy.namespace,
            trustForwardedFor: this.responsePolicy.trustForwardedFor,
            maxAttempts: rateLimit.maxAttempts,
            decaySeconds: rateLimit.decaySeconds,
            keyPrefix: memoryKeyPrefix,
          }),
        ),
      )(handler),
      "json",
      identityModes(handler),
      scimMiddleware(handler),
    );
  }
}

function createHttpKernel(dependencies: AppDependencies): HttpKernel {
  return new HttpKernel(dependencies);
}

export type { MiddlewareGroupName, WebGuestHome };
export { createHttpKernel, HttpKernel };
