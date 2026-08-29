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

export {
  appDisplayName,
  appKeyPrefix,
  appUserAgent,
  namespacedRedisKey,
  otelServiceName,
  siemEventType,
  smtpEhloHost,
  webhookSignatureHeader,
};
