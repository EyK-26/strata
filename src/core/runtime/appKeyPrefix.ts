import { type EnvRecord, isProductionEnv } from "./appEnv";

function appKeyPrefix(env: EnvRecord = process.env): string {
  return env.APP_KEY_PREFIX?.trim() || "strata";
}

function appCookieName(kind: string, env: EnvRecord = process.env): string {
  return `${appKeyPrefix(env)}_${kind}`;
}

function appDevSecret(kind: string, env: EnvRecord = process.env): string {
  return `${appKeyPrefix(env)}-dev-${kind}`;
}

/**
 * Use a configured secret, or a predictable local fallback. Production,
 * staging, and unrecognized APP_ENV values treated as production must set a
 * real secret; never derive one from the app name.
 */
function requireConfiguredSecret(
  names: readonly string[],
  devKind: string,
  env: EnvRecord = process.env,
): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }

  if (isProductionEnv(env)) {
    throw new Error(
      `${names[0]} must be set outside development. Do not derive secrets from the app name.`,
    );
  }

  return appDevSecret(devKind, env);
}

function namespacedRedisKey(kind: string): string {
  return `${appKeyPrefix()}:${kind}`;
}

function smtpEhloHost(env: EnvRecord = process.env): string {
  const raw = env.MAIL_EHLO?.trim() || `${appKeyPrefix(env)}.local`;
  const safe = raw.replace(/[^a-zA-Z0-9.-]/g, "");

  return safe || "strata.local";
}

function siemEventType(): string {
  return process.env.SIEM_EVENT_TYPE?.trim() || `${appKeyPrefix()}.audit`;
}

function appUserAgent(): string {
  return process.env.APP_USER_AGENT?.trim() || appKeyPrefix();
}

function otelServiceName(env: EnvRecord = process.env): string {
  return env.OTEL_SERVICE_NAME?.trim() || `${appKeyPrefix(env)}-api`;
}

function webhookSignatureHeader(): string {
  return process.env.WEBHOOK_SIGNATURE_HEADER?.trim() || `x-${appKeyPrefix()}-signature`;
}

function appDisplayName(): string {
  return process.env.APP_NAME?.trim() || "Strata";
}

function appEnv(): string {
  return process.env.APP_ENV?.trim() || "local";
}

function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

function apiPrefix(): string {
  const raw = process.env.API_PREFIX?.trim() || "/api/v1";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, "");

  return trimmed || "/api/v1";
}

function sdkClientClassName(): string {
  const override = process.env.APP_SDK_CLASS?.trim();

  if (override && /^[A-Za-z_][A-Za-z0-9_]*$/.test(override)) {
    return override;
  }

  const fromName = appDisplayName().replace(/[^A-Za-z0-9]/g, "");

  return fromName ? `${fromName}Client` : "AppClient";
}

export {
  apiPrefix,
  appCookieName,
  appDevSecret,
  appDisplayName,
  appEnv,
  appKeyPrefix,
  appUrl,
  appUserAgent,
  namespacedRedisKey,
  otelServiceName,
  requireConfiguredSecret,
  sdkClientClassName,
  siemEventType,
  smtpEhloHost,
  webhookSignatureHeader,
};
