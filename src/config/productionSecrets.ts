/**
 * WorkHub-only production extras. Published `@getstrata/bootstrap` secrets
 * stay feature-gated; this profile matches WorkHub's default-on flags.
 */
function assertWorkHubProductionSecrets(
  env: Record<string, string | undefined> = process.env,
): void {
  if ((env.APP_ENV ?? "local") !== "production") {
    return;
  }

  if (!env.KMS_ENCRYPTION_KEY?.trim() && (env.FEATURE_FIELD_ENCRYPTION ?? "true") !== "false") {
    throw new Error(
      "Production startup blocked: set KMS_ENCRYPTION_KEY when field encryption is enabled.",
    );
  }

  if (!env.STRIPE_WEBHOOK_SECRET?.trim() && (env.FEATURE_BILLING ?? "true") !== "false") {
    throw new Error(
      "Production startup blocked: set STRIPE_WEBHOOK_SECRET when billing webhooks are enabled.",
    );
  }

  if (!env.OAUTH_STATE_SECRET?.trim()) {
    throw new Error(
      "Production startup blocked: set OAUTH_STATE_SECRET for OAuth CSRF protection.",
    );
  }

  const corsOrigins = (env.CORS_ALLOWED_ORIGINS ?? "*").split(",").map((origin) => origin.trim());

  if (corsOrigins.includes("*")) {
    throw new Error(
      "Production startup blocked: set explicit CORS_ALLOWED_ORIGINS instead of wildcard.",
    );
  }

  if ((env.FEATURE_PUBLIC_READS ?? "true") !== "false") {
    throw new Error(
      "Production startup blocked: set FEATURE_PUBLIC_READS=false for authenticated-only reads.",
    );
  }

  if (!env.SIEM_EXPORT_URL?.trim() && (env.FEATURE_SIEM_EXPORT ?? "true") !== "false") {
    console.warn("[secrets] SIEM_EXPORT_URL is not configured; audit logs remain database-only.");
  }
}

export { assertWorkHubProductionSecrets };
