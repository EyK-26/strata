/** Deny-list of WorkHub local test tokens. Not defaults for production. */
const DEFAULT_ADMIN_API_TOKEN = "workhub-admin-test-token";
const DEFAULT_MEMBER_API_TOKEN = "workhub-member-test-token";
const DEFAULT_SCIM_BEARER_TOKEN = "workhub-scim-test-token";
const MIN_SESSION_SECRET_LENGTH = 32;

const DEFAULT_TOKENS = new Set([DEFAULT_ADMIN_API_TOKEN, DEFAULT_MEMBER_API_TOKEN]);
const DEFAULT_SCIM_TOKENS = new Set([DEFAULT_SCIM_BEARER_TOKEN]);

function isEnabled(value: string | undefined, defaultEnabled: boolean): boolean {
  if (value === undefined) {
    return defaultEnabled;
  }

  return defaultEnabled ? value !== "false" : value === "true";
}

function isTokenAuthEnabled(env: Record<string, string | undefined>): boolean {
  return (
    Boolean(env.ADMIN_API_TOKEN?.trim()) ||
    Boolean(env.MEMBER_API_TOKEN?.trim()) ||
    env.FEATURE_API_TOKENS === "true"
  );
}

function isOAuthEnabled(env: Record<string, string | undefined>): boolean {
  return (
    isEnabled(env.FEATURE_OAUTH, false) ||
    isEnabled(env.FEATURE_SAML, false) ||
    Boolean(env.GITHUB_CLIENT_ID?.trim()) ||
    Boolean(env.OIDC_ISSUER?.trim()) ||
    Boolean(env.SAML_LOGIN_URL?.trim())
  );
}

function isCorsConfigured(env: Record<string, string | undefined>): boolean {
  return env.CORS_ALLOWED_ORIGINS !== undefined;
}

function assertAuthDevHeadersDisabled(env: Record<string, string | undefined>): void {
  if (isEnabled(env.AUTH_DEV_HEADERS, true)) {
    throw new Error(
      "Production startup blocked: set AUTH_DEV_HEADERS=false to disable development auth headers.",
    );
  }
}

function assertSessionSecret(env: Record<string, string | undefined>): void {
  const secret = env.SESSION_SECRET?.trim() ?? "";

  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      "Production startup blocked: set SESSION_SECRET when FRONTEND_MODE=server-htmx (32+ characters).",
    );
  }
}

function assertWorkHubProductionSecrets(env: Record<string, string | undefined>): void {
  const adminToken = env.ADMIN_API_TOKEN ?? DEFAULT_ADMIN_API_TOKEN;
  const memberToken = env.MEMBER_API_TOKEN ?? DEFAULT_MEMBER_API_TOKEN;
  const scimToken = env.SCIM_BEARER_TOKEN ?? DEFAULT_SCIM_BEARER_TOKEN;
  const encryptionEnabled = isEnabled(env.FEATURE_FIELD_ENCRYPTION, true);

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
}

function assertSiblingProductionSecrets(env: Record<string, string | undefined>): void {
  if (isEnabled(env.FEATURE_SCIM, false)) {
    const scimToken = env.SCIM_BEARER_TOKEN ?? DEFAULT_SCIM_BEARER_TOKEN;

    if (DEFAULT_SCIM_TOKENS.has(scimToken) || !env.SCIM_BEARER_TOKEN?.trim()) {
      throw new Error(
        "Production startup blocked: rotate SCIM_BEARER_TOKEN away from default WorkHub test values.",
      );
    }
  }

  if (isEnabled(env.FEATURE_FIELD_ENCRYPTION, false) && !env.KMS_ENCRYPTION_KEY?.trim()) {
    throw new Error(
      "Production startup blocked: set KMS_ENCRYPTION_KEY when field encryption is enabled.",
    );
  }

  if (isEnabled(env.FEATURE_BILLING, false) && !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    throw new Error(
      "Production startup blocked: set STRIPE_WEBHOOK_SECRET when billing webhooks are enabled.",
    );
  }

  if (isOAuthEnabled(env) && !env.OAUTH_STATE_SECRET?.trim()) {
    throw new Error(
      "Production startup blocked: set OAUTH_STATE_SECRET for OAuth CSRF protection.",
    );
  }

  if (isCorsConfigured(env)) {
    const corsOrigins = (env.CORS_ALLOWED_ORIGINS ?? "*").split(",").map((origin) => origin.trim());

    if (corsOrigins.includes("*")) {
      throw new Error(
        "Production startup blocked: set explicit CORS_ALLOWED_ORIGINS instead of wildcard.",
      );
    }
  }

  if (isEnabled(env.FEATURE_PUBLIC_READS, false)) {
    throw new Error(
      "Production startup blocked: set FEATURE_PUBLIC_READS=false for authenticated-only reads.",
    );
  }

  if (!env.SIEM_EXPORT_URL?.trim() && isEnabled(env.FEATURE_SIEM_EXPORT, false)) {
    console.warn("[secrets] SIEM_EXPORT_URL is not configured; audit logs remain database-only.");
  }
}

function assertProductionSecrets(env: Record<string, string | undefined> = process.env): void {
  const appEnv = env.APP_ENV ?? "local";

  if (appEnv !== "production") {
    return;
  }

  assertAuthDevHeadersDisabled(env);

  if (isTokenAuthEnabled(env)) {
    assertWorkHubProductionSecrets(env);
  } else {
    assertSiblingProductionSecrets(env);
  }

  const frontendMode = (env.FRONTEND_MODE ?? "api").trim();

  if (frontendMode === "server-htmx") {
    assertSessionSecret(env);
  }
}

export { assertProductionSecrets };
