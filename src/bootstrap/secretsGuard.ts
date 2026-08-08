import { appConfig } from "../config/app";
import {
  TEST_ADMIN_API_TOKEN,
  TEST_MEMBER_API_TOKEN,
} from "../domain/auth";

const DEFAULT_TOKENS = new Set([TEST_ADMIN_API_TOKEN, TEST_MEMBER_API_TOKEN]);

function assertProductionSecrets(
  env: Record<string, string | undefined> = process.env,
): void {
  const appEnv = env.APP_ENV ?? appConfig.env;

  if (appEnv !== "production") {
    return;
  }

  const adminToken = env.ADMIN_API_TOKEN ?? TEST_ADMIN_API_TOKEN;
  const memberToken = env.MEMBER_API_TOKEN ?? TEST_MEMBER_API_TOKEN;

  if (DEFAULT_TOKENS.has(adminToken) || DEFAULT_TOKENS.has(memberToken)) {
    throw new Error(
      "Production startup blocked: rotate ADMIN_API_TOKEN and MEMBER_API_TOKEN away from default WorkHub test values.",
    );
  }
}

export { assertProductionSecrets };
