import { TEST_ADMIN_API_TOKEN, TEST_MEMBER_API_TOKEN } from "../../src/domain/auth";
import { TEST_SCIM_BEARER_TOKEN } from "../../src/domain/scim";

/** Pin integration tests to the same seeded API tokens and hash pepper. */
function pinWorkhubIntegrationEnv(): void {
  process.env.ADMIN_API_TOKEN = TEST_ADMIN_API_TOKEN;
  process.env.MEMBER_API_TOKEN = TEST_MEMBER_API_TOKEN;
  process.env.SCIM_BEARER_TOKEN = TEST_SCIM_BEARER_TOKEN;
  process.env.FEATURE_SCIM = "true";
  process.env.FEATURE_WEBHOOKS = "true";
  delete process.env.TOKEN_HASH_PEPPER;
}

export { pinWorkhubIntegrationEnv };
