import { postgresAppRoleSql } from "@getstrata/core/tenant/enableTenantRls";
import {
  appDatabaseName,
  defaultDatabaseUrl,
  defaultMigrationDatabaseUrl,
  GENERATED_POSTGRES_APP_PASSWORD,
  GENERATED_POSTGRES_APP_ROLE,
} from "./databaseDefaults.ts";
import {
  authUsesCookie,
  authUsesJwt,
  authUsesToken,
  needsRedis,
  type StarterLayers,
} from "./types.ts";

function envFlag(value: boolean): string {
  return value ? "true" : "false";
}

function postgresAppRoleEnvNotes(layers: StarterLayers): string[] {
  if (layers.database !== "postgres") {
    return [];
  }
  return [
    `# Runtime DATABASE_URL is ${GENERATED_POSTGRES_APP_ROLE} (NOSUPERUSER NOBYPASSRLS).`,
    "# MIGRATION_DATABASE_URL belongs to the explicit migration/provisioning process, never HTTP/workers.",
    "# Production provisioning also requires STRATA_APP_PASSWORD matching the restricted role credential.",
    "# STRATA_APP_PASSWORD=",
    "# db/ensure-postgres-app-role.sql is repeatable on an existing volume, not only docker-entrypoint-initdb.d.",
    layers.tenancy === "rls"
      ? "# Production TENANCY_DRIVER=rls inspects pg_roles (rolsuper / rolbypassrls), not only the URL username."
      : "# This app is not TENANCY_DRIVER=rls; still do not point runtime traffic at the postgres superuser.",
  ];
}

function renderPostgresAppRoleInitSql(projectName: string, layers: StarterLayers): string | null {
  if (layers.database !== "postgres") {
    return null;
  }
  return `BEGIN;
${postgresAppRoleSql({
  database: appDatabaseName(projectName),
  role: GENERATED_POSTGRES_APP_ROLE,
  password: GENERATED_POSTGRES_APP_PASSWORD,
})}COMMIT;
`;
}

function renderEnvExample(projectName: string, layers: StarterLayers): string {
  const lines = [
    `APP_NAME=${projectName}`,
    `APP_KEY_PREFIX=${projectName}`,
    "APP_ENV=local",
    "PORT=3000",
    "# Optional TCP listen address, separate from public APP_URL / tenant hosts.",
    "# HOST=0.0.0.0",
    "# Total graceful shutdown budget in milliseconds; keep deployment grace longer.",
    "SHUTDOWN_TIMEOUT_MS=30000",
    "APP_URL=http://localhost:3000",
    `DATABASE_URL=${defaultDatabaseUrl(layers, projectName)}`,
    ...postgresAppRoleEnvNotes(layers),
    ...(layers.database === "postgres"
      ? [`MIGRATION_DATABASE_URL=${defaultMigrationDatabaseUrl(layers, projectName)}`]
      : []),
    ...(layers.database === "mysql"
      ? [
          "# Optional schema-administration URL for the same database; runtime may lack DDL.",
          "# MIGRATION_DATABASE_URL=",
        ]
      : []),
    ...(layers.database === "sqlite"
      ? []
      : [
          "# Optional. Point runtime at a different database than DATABASE_URL.",
          "# APP_DATABASE_URL=",
        ]),
    `DB_CONNECTION=${layers.database === "postgres" ? "pgsql" : layers.database}`,
    `FRONTEND_MODE=${layers.frontend}`,
    `SPA_PREFIX=${layers.spaPrefix}`,
    `TENANCY_DRIVER=${layers.tenancy}`,
    `CACHE_DRIVER=${layers.cache}`,
    `QUEUE_DRIVER=${layers.queue}`,
    ...(layers.queue === "redis"
      ? [
          "# New apps use Streams. Do not point this at Redis that still holds list jobs.",
          "QUEUE_REDIS_TRANSPORT=streams",
        ]
      : []),
    `MAIL_DRIVER=${layers.mail}`,
    `AUTH_DEV_HEADERS=${envFlag(layers.auth === "headers")}`,
  ];

  lines.push(
    "# Scheduler coordination defaults to Redis in production, one process in development.",
  );
  lines.push("# SCHEDULER_COORDINATION=redis");
  lines.push("APP_DEBUG=false");
  lines.push("TENANT_DEV_HEADERS=false");
  lines.push("# Development-only anonymous x-tenant-id selection; never enable in production.");
  lines.push("FEATURE_PUBLIC_READS=false");
  lines.push(
    "# wrapWebPublicRead / wrapPublicRead require login when false (production-safe default).",
  );
  lines.push(
    "# Public reads do not enable tenant headers. Production guest tenancy requires CORE_PUBLIC_TENANCY_TOKEN.",
  );
  lines.push("FEATURE_SIEM_EXPORT=false");
  lines.push("# SIEM_EXPORT_URL=");
  lines.push("# SIEM_EXPORT_TOKEN=");
  lines.push("FEATURE_REGISTRATION=true");
  lines.push("FEATURE_SAML=false");
  lines.push("# SAML_IDP_SSO_URL=");
  lines.push("# SAML_IDP_CERT=");
  lines.push("# SAML_SP_ENTITY_ID=");
  lines.push("# SAML_ACS_URL=");
  lines.push("# SAML_IDP_ISSUER=");
  lines.push("# SAML_WANT_RESPONSE_SIGNED=");
  lines.push("# SAML_DISABLE_REQUESTED_AUTHN_CONTEXT=");

  const githubOn = Boolean(layers.extras.oauthGithub);
  const oidcOn = Boolean(layers.extras.oidc);
  lines.push(`FEATURE_OAUTH=${envFlag(githubOn || oidcOn)}`);
  if (githubOn) {
    lines.push("GITHUB_CLIENT_ID=");
    lines.push("GITHUB_CLIENT_SECRET=");
    lines.push("GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback");
  } else {
    lines.push("# GITHUB_CLIENT_ID=");
    lines.push("# GITHUB_CLIENT_SECRET=");
    lines.push("# GITHUB_REDIRECT_URI=http://localhost:3000/auth/github/callback");
  }
  if (oidcOn) {
    lines.push("OIDC_ISSUER=http://127.0.0.1:8080");
    lines.push("OIDC_CLIENT_ID=");
    lines.push("OIDC_CLIENT_SECRET=");
    lines.push("OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback");
    lines.push(
      "# Loopback issuers are allowed when APP_ENV is not production. Other private IdPs:",
    );
    lines.push("# OIDC_ALLOW_PRIVATE=true");
  } else {
    lines.push("# OIDC_ISSUER=");
    lines.push("# OIDC_CLIENT_ID=");
    lines.push("# OIDC_CLIENT_SECRET=");
    lines.push("# OIDC_REDIRECT_URI=http://localhost:3000/auth/oidc/callback");
    lines.push("# OIDC_ALLOW_PRIVATE=true");
  }
  if (githubOn || oidcOn) {
    lines.push("OAUTH_STATE_SECRET=dev-oauth-state-secret-change-me-please-32");
  } else {
    lines.push("# OAUTH_STATE_SECRET=");
  }
  lines.push(
    "# --oidc (cookie HTML) seals PKCE in the oidc_pkce cookie. Do not call OidcProvider.getAuthorizationUrl().",
  );

  lines.push("# Explicit browser origins and application request headers (defaults stay enabled):");
  lines.push("# CORS_ALLOWED_ORIGINS=https://app.example.com");
  lines.push("# CORS_ADDITIONAL_ALLOWED_HEADERS=Idempotency-Key,X-Correlation-Id");

  const billingOn = Boolean(layers.extras.billing);
  lines.push(`FEATURE_BILLING=${envFlag(billingOn)}`);
  if (billingOn) {
    lines.push("STRIPE_WEBHOOK_SECRET=whsec_change-me");
  } else {
    lines.push("# STRIPE_WEBHOOK_SECRET=");
  }

  lines.push("# Outbound webhook deliveries (create-strata --webhooks). Local receivers:");
  lines.push("# WEBHOOK_ALLOW_PRIVATE=true");
  lines.push("# WEBHOOK_SIGNATURE_HEADER=");

  if (needsRedis(layers)) {
    lines.push("REDIS_PASSWORD=dev-redis-change-me");
    lines.push("REDIS_URL=redis://:dev-redis-change-me@127.0.0.1:6379");
  } else {
    lines.push("# REDIS_PASSWORD=");
    lines.push("# REDIS_URL=redis://127.0.0.1:6379");
  }

  if (
    authUsesCookie(layers.auth) ||
    layers.frontend === "server-htmx" ||
    layers.frontend === "hybrid"
  ) {
    lines.push("SESSION_SECRET=dev-session-secret-change-me-please-32ch");
  } else {
    lines.push("# SESSION_SECRET=");
  }

  if (authUsesJwt(layers.auth)) {
    lines.push("JWT_SECRET=dev-jwt-secret-change-me-please-32chars");
    lines.push("JWT_TTL_SECONDS=3600");
  } else {
    lines.push("# JWT_SECRET=");
  }

  if (authUsesToken(layers.auth)) {
    lines.push("FEATURE_API_TOKENS=true");
    lines.push("TOKEN_HASH_PEPPER=dev-token-pepper-change-me");
    lines.push("API_TOKEN_DEFAULT_EXPIRY_DAYS=30");
  } else {
    lines.push("# FEATURE_API_TOKENS=false");
  }

  lines.push(`FEATURE_MFA=${envFlag(layers.extras.mfa)}`);
  if (layers.extras.mfa) {
    lines.push(
      "KMS_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
  } else {
    lines.push("# KMS_ENCRYPTION_KEY=");
  }
  lines.push(
    "# Optional reader-first encryption rotation; replaces KMS_ENCRYPTION_KEY, never set both.",
  );
  lines.push(
    "# KMS_ENCRYPTION_KEYRING= (see framework ENCRYPTION-ROTATION.md; no automatic migration)",
  );
  lines.push(`FEATURE_EMAIL_VERIFICATION=${envFlag(layers.extras.emailVerification)}`);

  if (layers.extras.metrics) {
    lines.push("METRICS_TOKEN=dev-metrics-token-change-me");
  } else {
    lines.push("# METRICS_TOKEN=");
  }

  if (layers.extras.scim) {
    lines.push("FEATURE_SCIM=true");
    lines.push("SCIM_BEARER_TOKEN=dev-scim-token-change-me");
    lines.push("# SCIM_TENANT_TOKENS=1:token-a");
  } else {
    lines.push("# FEATURE_SCIM=false");
    lines.push("# SCIM_BEARER_TOKEN=");
  }

  if (layers.database === "mysql") {
    lines.push(`MYSQL_URL=${defaultDatabaseUrl(layers, projectName)}`);
  }

  if (layers.mail === "smtp") {
    lines.push("MAIL_HOST=localhost");
    lines.push("MAIL_PORT=1025");
    lines.push(`MAIL_FROM=noreply@${projectName}.local`);
    lines.push(
      "# true selects verified implicit TLS; false is plaintext (local Mailpit). STARTTLS is not negotiated.",
    );
    lines.push("MAIL_SECURE=false");
    lines.push("MAIL_TIMEOUT_MS=10000");
  } else {
    lines.push("# MAIL_HOST=");
    lines.push("# MAIL_FROM=");
  }

  lines.push(
    "# Behind a reverse proxy, trust X-Forwarded-For (rightmost public hop) for throttles and session IPs.",
  );
  lines.push("# TRUST_FORWARDED_FOR=true");
  return `${lines.join("\n")}\n`;
}

export { renderEnvExample, renderPostgresAppRoleInitSql };
