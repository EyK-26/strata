/** Deny-list of WorkHub local test tokens. Not defaults for production. */
const DEFAULT_ADMIN_API_TOKEN = "workhub-admin-test-token";
const DEFAULT_MEMBER_API_TOKEN = "workhub-member-test-token";
const DEFAULT_SCIM_BEARER_TOKEN = "workhub-scim-test-token";

const DEFAULT_TOKENS = new Set([DEFAULT_ADMIN_API_TOKEN, DEFAULT_MEMBER_API_TOKEN]);
const DEFAULT_SCIM_TOKENS = new Set([DEFAULT_SCIM_BEARER_TOKEN]);

function isEnabled(value: string | undefined, defaultEnabled: boolean): boolean {
  if (value === undefined) {
    return defaultEnabled;
  }

  return defaultEnabled ? value !== "false" : value === "true";
}

function assertProductionSecrets(env: Record<string, string | undefined> = process.env): void {
  const appEnv = env.APP_ENV ?? "local";

  if (appEnv !== "production") {
    return;
  }

  const adminToken = env.ADMIN_API_TOKEN ?? DEFAULT_ADMIN_API_TOKEN;
  const memberToken = env.MEMBER_API_TOKEN ?? DEFAULT_MEMBER_API_TOKEN;
  const scimToken = env.SCIM_BEARER_TOKEN ?? DEFAULT_SCIM_BEARER_TOKEN;
  const encryptionEnabled = isEnabled(env.FEATURE_FIELD_ENCRYPTION, true);
  const devHeadersEnabled = isEnabled(env.AUTH_DEV_HEADERS, true);

  if (devHeadersEnabled) {
    throw new Error(
      "Production startup blocked: set AUTH_DEV_HEADERS=false to disable development auth headers.",
    );
  }

  if (DEFAULT_TOKENS.has(adminToken) || DEFAULT_TOKENS.has(memberToken)) {
    throw new Error(
      "Production startup blocked: rotate ADMIN_API_TOKEN and MEMBER_API_TOKEN away from default WorkHub test values.",
    );
  }

  if (DEFAULT_SCIM_TOKENS.has(scimToken)) {
    throw new Error(
      "Production startup blocked: rotate SCIM_BEARER_TOKEN away from default WorkHub test values.",
    );
  }

  if (encryptionEnabled && !env.KMS_ENCRYPTION_KEY?.trim()) {
    throw new Error(
      "Production startup blocked: set KMS_ENCRYPTION_KEY when field encryption is enabled.",
    );
  }

  if (!env.SIEM_EXPORT_URL?.trim() && isEnabled(env.FEATURE_SIEM_EXPORT, true)) {
    console.warn("[secrets] SIEM_EXPORT_URL is not configured; audit logs remain database-only.");
  }

  if (isEnabled(env.FEATURE_BILLING, true) && !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    throw new Error(
      "Production startup blocked: set STRIPE_WEBHOOK_SECRET when billing webhooks are enabled.",
    );
  }

  const corsOrigins = (env.CORS_ALLOWED_ORIGINS ?? "*").split(",").map((origin) => origin.trim());

  if (corsOrigins.includes("*")) {
    throw new Error(
      "Production startup blocked: set explicit CORS_ALLOWED_ORIGINS instead of wildcard.",
    );
  }

  if (isEnabled(env.FEATURE_PUBLIC_READS, true)) {
    throw new Error(
      "Production startup blocked: set FEATURE_PUBLIC_READS=false for authenticated-only reads.",
    );
  }

  if (!env.OAUTH_STATE_SECRET?.trim()) {
    throw new Error(
      "Production startup blocked: set OAUTH_STATE_SECRET for OAuth CSRF protection.",
    );
  }

  if (!env.TOKEN_HASH_PEPPER?.trim()) {
    throw new Error("Production startup blocked: set TOKEN_HASH_PEPPER for API token hashing.");
  }

  if (!env.API_TOKEN_DEFAULT_EXPIRY_DAYS?.trim()) {
    throw new Error(
      "Production startup blocked: set API_TOKEN_DEFAULT_EXPIRY_DAYS to enforce token rotation.",
    );
  }

  const frontendMode = (env.FRONTEND_MODE ?? "api").trim();

  if (frontendMode === "server-htmx" && !env.SESSION_SECRET?.trim()) {
    throw new Error(
      "Production startup blocked: set SESSION_SECRET when FRONTEND_MODE=server-htmx.",
    );
  }
}

export { assertProductionSecrets };
