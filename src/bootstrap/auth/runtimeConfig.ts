import {
  type PasswordConfirmWriteOptions,
  passwordConfirmCookieName,
  passwordConfirmTtlSeconds,
} from "@getstrata/core/auth/passwordConfirmCookie";
import { readSamlEnvOptions } from "@getstrata/core/auth/saml/samlServiceProvider";
import { resolveEnv } from "@getstrata/core/config/envSchema";
import { requireConfiguredSecret } from "@getstrata/core/runtime/appKeyPrefix";
import { resolveScimTenantFromToken } from "@getstrata/core/security/scimTenantTokens";

export interface AuthRuntimeOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly production: boolean;
  readonly jwtSecret: string;
  readonly sessionSecret?: string;
  readonly signatureSecret?: string;
  readonly oauthStateSecret?: string;
  readonly passwordConfirmation?: PasswordConfirmWriteOptions;
}
export interface AuthRuntimeFeatures {
  readonly users: boolean;
  readonly cookie: boolean;
  readonly token: boolean;
  readonly jwt: boolean;
  readonly signedUrls: boolean;
}

/** Resolve security options once at composition, before any request can observe them. */
export function createAuthRuntimeConfig(
  options: AuthRuntimeOptions,
  features: AuthRuntimeFeatures,
) {
  const env = Object.freeze({ ...options.environment });
  const numeric = resolveEnv(
    {
      API_TOKEN_DEFAULT_EXPIRY_DAYS: { integer: true, minimum: 1 },
      JWT_TTL_SECONDS: { integer: true, minimum: 60, default: "3600" },
    },
    {
      API_TOKEN_DEFAULT_EXPIRY_DAYS: features.token ? env.API_TOKEN_DEFAULT_EXPIRY_DAYS : undefined,
      JWT_TTL_SECONDS: features.jwt ? env.JWT_TTL_SECONDS : undefined,
    },
  );
  if (features.jwt && !options.jwtSecret.trim())
    throw new TypeError("An explicit JWT secret is required.");
  if (features.cookie && !options.sessionSecret?.trim())
    throw new TypeError("SESSION_SECRET is required for cookie authentication.");
  const secretsEnv = Object.freeze({
    ...env,
    ...(options.sessionSecret ? { SESSION_SECRET: options.sessionSecret } : {}),
  });
  const configuredAppUrl = env.APP_URL ?? "http://localhost:3000";
  const appUrl = configuredAppUrl.endsWith("/") ? configuredAppUrl.slice(0, -1) : configuredAppUrl;
  const production = options.production;
  return Object.freeze({
    sessionCookie: Object.freeze({
      cookieName:
        env.SESSION_COOKIE_NAME?.trim() || (env.APP_KEY_PREFIX?.trim() || "strata") + "_session",
      production,
    }),
    registrationEnabled: (env.FEATURE_REGISTRATION ?? "true") !== "false",
    scimEnabled: (env.FEATURE_SCIM ?? "false") === "true",
    redisUrl: env.REDIS_URL,
    samlEnabled: env.FEATURE_SAML === "true",
    oauthEnabled: env.FEATURE_OAUTH === "true",
    appName: env.APP_NAME ?? "Strata",
    appUrl,
    saml:
      features.cookie && env.FEATURE_SAML === "true"
        ? Object.freeze(readSamlEnvOptions(env))
        : undefined,
    github: Object.freeze({
      clientId: env.GITHUB_CLIENT_ID?.trim() ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET?.trim() ?? "",
      redirectUri: env.GITHUB_REDIRECT_URI?.trim() || appUrl + "/auth/github/callback",
      production,
      userAgent: env.APP_USER_AGENT?.trim() || env.APP_KEY_PREFIX?.trim() || "strata",
    }),
    oidc: Object.freeze({
      issuer: env.OIDC_ISSUER?.trim() ?? "",
      clientId: env.OIDC_CLIENT_ID?.trim() ?? "",
      clientSecret: env.OIDC_CLIENT_SECRET?.trim() ?? "",
      redirectUri: env.OIDC_REDIRECT_URI?.trim() || appUrl + "/auth/oidc/callback",
      networkPolicy: Object.freeze({ production, allowPrivate: env.OIDC_ALLOW_PRIVATE === "true" }),
    }),
    throttleNamespace: env.APP_KEY_PREFIX?.trim() || "strata",
    trustForwardedFor: env.TRUST_FORWARDED_FOR === "true",
    scimTenantForToken: (token: string) => resolveScimTenantFromToken(token, env),
    tokenExpiryDays: features.token ? (numeric.API_TOKEN_DEFAULT_EXPIRY_DAYS ?? null) : null,
    jwtTtlSeconds: numeric.JWT_TTL_SECONDS ?? 3600,
    jwtSecret: options.jwtSecret,
    signatureSecret:
      options.signatureSecret ??
      (features.signedUrls
        ? requireConfiguredSecret(
            ["SIGNED_URL_SECRET", "SESSION_SECRET", "OAUTH_STATE_SECRET"],
            "signed-url-secret",
            secretsEnv,
          )
        : options.jwtSecret),
    oauth: Object.freeze({
      secret:
        options.oauthStateSecret ??
        (features.cookie
          ? requireConfiguredSecret(
              ["OAUTH_STATE_SECRET", "SESSION_SECRET"],
              "oauth-state-secret",
              secretsEnv,
            )
          : options.jwtSecret),
      production,
    }),
    passwordConfirmation: Object.freeze(
      options.passwordConfirmation
        ? { ...options.passwordConfirmation }
        : {
            secret: features.cookie
              ? requireConfiguredSecret(
                  ["SESSION_SECRET", "OAUTH_STATE_SECRET"],
                  "session-secret",
                  secretsEnv,
                )
              : options.jwtSecret,
            cookieName: features.cookie
              ? passwordConfirmCookieName(env)
              : "strata_password_confirmed",
            ttlSeconds: features.cookie ? passwordConfirmTtlSeconds(env) : 10800,
            production,
          },
    ),
  });
}
