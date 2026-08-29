function appKeyPrefix(): string {
  return process.env.APP_KEY_PREFIX?.trim() || "workhub";
}

function namespacedRedisKey(kind: string): string {
  return `${appKeyPrefix()}:${kind}`;
}

function smtpEhloHost(): string {
  const raw = process.env.MAIL_EHLO?.trim() || `${appKeyPrefix()}.local`;
  const safe = raw.replace(/[^a-zA-Z0-9.-]/g, "");

  return safe || "strata.local";
}

function siemEventType(): string {
  return process.env.SIEM_EVENT_TYPE?.trim() || `${appKeyPrefix()}.audit`;
}

function appUserAgent(): string {
  return process.env.APP_USER_AGENT?.trim() || appKeyPrefix();
}

function otelServiceName(): string {
  return process.env.OTEL_SERVICE_NAME?.trim() || `${appKeyPrefix()}-api`;
}

function webhookSignatureHeader(): string {
  return process.env.WEBHOOK_SIGNATURE_HEADER?.trim() || `x-${appKeyPrefix()}-signature`;
}

function appDisplayName(): string {
  return process.env.APP_NAME?.trim() || "WorkHub";
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
  appDisplayName,
  appEnv,
  appKeyPrefix,
  appUrl,
  appUserAgent,
  namespacedRedisKey,
  otelServiceName,
  sdkClientClassName,
  siemEventType,
  smtpEhloHost,
  webhookSignatureHeader,
};
