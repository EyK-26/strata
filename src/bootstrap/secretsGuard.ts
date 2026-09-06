import { isViewsMode, parseFrontendMode } from "@getstrata/core/runtime/frontendMode";

/** Published test-token strings that must never ship in production. */
const PUBLISHED_TEST_ADMIN_API_TOKEN = "strata-admin-test-token";
const PUBLISHED_TEST_MEMBER_API_TOKEN = "strata-member-test-token";
const PUBLISHED_TEST_SCIM_BEARER_TOKEN = "strata-scim-test-token";
const MIN_SESSION_SECRET_LENGTH = 32;

const PUBLISHED_TEST_TOKENS = new Set([
  PUBLISHED_TEST_ADMIN_API_TOKEN,
  PUBLISHED_TEST_MEMBER_API_TOKEN,
]);
const PUBLISHED_TEST_SCIM_TOKENS = new Set([PUBLISHED_TEST_SCIM_BEARER_TOKEN]);

/**
 * Secrets the generator writes into `.env.example`. They are long enough to
 * pass a length check, so production has to reject them by shape. Every
 * generated placeholder carries "change-me"; keep that convention.
 */
const PLACEHOLDER_SECRET_PATTERN = /change-me/i;

/** Secrets that must be rotated before an app boots with APP_ENV=production. */
const SECRETS_TO_ROTATE = [
  "SESSION_SECRET",
  "TOKEN_HASH_PEPPER",
  "METRICS_TOKEN",
  "SCIM_BEARER_TOKEN",
  "JWT_SECRET",
  "OAUTH_STATE_SECRET",
  "KMS_ENCRYPTION_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ADMIN_API_TOKEN",
  "MEMBER_API_TOKEN",
] as const;

function assertNoPlaceholderSecrets(env: Record<string, string | undefined>): void {
  const unrotated = SECRETS_TO_ROTATE.filter((name) =>
    PLACEHOLDER_SECRET_PATTERN.test(env[name]?.trim() ?? ""),
  );

  if (unrotated.length > 0) {
    throw new Error(
      `Production startup blocked: replace the generated placeholder values for ${unrotated.join(", ")}.`,
    );
  }
}

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
      "Production startup blocked: set SESSION_SECRET when FRONTEND_MODE=server-htmx or hybrid (32+ characters).",
    );
  }
}

function assertPublishedTestTokensRotated(env: Record<string, string | undefined>): void {
  const adminToken = env.ADMIN_API_TOKEN ?? "";
  const memberToken = env.MEMBER_API_TOKEN ?? "";
  const scimToken = env.SCIM_BEARER_TOKEN ?? "";

  if (PUBLISHED_TEST_TOKENS.has(adminToken) || PUBLISHED_TEST_TOKENS.has(memberToken)) {
    throw new Error(
      "Production startup blocked: rotate ADMIN_API_TOKEN and MEMBER_API_TOKEN away from published test defaults.",
    );
  }

  if (scimToken && PUBLISHED_TEST_SCIM_TOKENS.has(scimToken)) {
    throw new Error(
      "Production startup blocked: rotate SCIM_BEARER_TOKEN away from published test defaults.",
    );
  }
}

function assertTokenAuthProductionSecrets(env: Record<string, string | undefined>): void {
  assertPublishedTestTokensRotated(env);

  if (!env.TOKEN_HASH_PEPPER?.trim()) {
    throw new Error("Production startup blocked: set TOKEN_HASH_PEPPER for API token hashing.");
  }

  if (!env.API_TOKEN_DEFAULT_EXPIRY_DAYS?.trim()) {
    throw new Error(
      "Production startup blocked: set API_TOKEN_DEFAULT_EXPIRY_DAYS to enforce token rotation.",
    );
  }
}

function assertFeatureProductionSecrets(env: Record<string, string | undefined>): void {
  if (isEnabled(env.FEATURE_SCIM, false)) {
    const scimToken = env.SCIM_BEARER_TOKEN ?? PUBLISHED_TEST_SCIM_BEARER_TOKEN;

    if (PUBLISHED_TEST_SCIM_TOKENS.has(scimToken) || !env.SCIM_BEARER_TOKEN?.trim()) {
      throw new Error(
        "Production startup blocked: rotate SCIM_BEARER_TOKEN away from published test defaults.",
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

  assertNoPlaceholderSecrets(env);
  assertAuthDevHeadersDisabled(env);

  if (isTokenAuthEnabled(env)) {
    assertTokenAuthProductionSecrets(env);
  }

  assertFeatureProductionSecrets(env);

  if (isViewsMode(parseFrontendMode(env.FRONTEND_MODE))) {
    assertSessionSecret(env);
  }
}

export { assertProductionSecrets };
