import { appConfig } from "../config/app";
import { TEST_ADMIN_API_TOKEN, TEST_MEMBER_API_TOKEN } from "../domain/auth";
import { DEFAULT_SCIM_BEARER_TOKEN, TEST_SCIM_BEARER_TOKEN } from "../domain/scim";

const DEFAULT_TOKENS = new Set([TEST_ADMIN_API_TOKEN, TEST_MEMBER_API_TOKEN]);
const DEFAULT_SCIM_TOKENS = new Set([TEST_SCIM_BEARER_TOKEN, DEFAULT_SCIM_BEARER_TOKEN]);

function assertProductionSecrets(env: Record<string, string | undefined> = process.env): void {
  const appEnv = env.APP_ENV ?? appConfig.env;

  if (appEnv !== "production") {
    return;
  }

  const adminToken = env.ADMIN_API_TOKEN ?? TEST_ADMIN_API_TOKEN;
  const memberToken = env.MEMBER_API_TOKEN ?? TEST_MEMBER_API_TOKEN;
  const scimToken = env.SCIM_BEARER_TOKEN ?? DEFAULT_SCIM_BEARER_TOKEN;
  const encryptionEnabled = env.FEATURE_FIELD_ENCRYPTION !== "false";

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

  if (!env.SIEM_EXPORT_URL?.trim() && env.FEATURE_SIEM_EXPORT !== "false") {
    console.warn("[secrets] SIEM_EXPORT_URL is not configured; audit logs remain database-only.");
  }
}

export { assertProductionSecrets };
