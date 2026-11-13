import type { StarterFeaturePlan } from "../featurePlan.ts";

// The compiler owns capability policy; this context adds only rendered SQL fragments.
export function createAuthRenderingContext(plan: StarterFeaturePlan) {
  const { cookie, github, oidc, mfa, bearerApi, jsonCookieAccounts, jsonAccounts } = plan.decisions;
  const verify = plan.decisions.emailVerification;
  const tenantInsert = plan.decisions.tenantTable;
  const tenantCreateField = tenantInsert
    ? `
                tenant_id: establishedTenantId(ports),`
    : "";
  const samlTenantCreateField = tenantInsert
    ? `
                  tenant_id: establishedTenantId(ports),`
    : "";

  return {
    plan,
    cookie,
    github,
    oidc,
    mfa,
    verify,
    bearerApi,
    jsonCookieAccounts,
    jsonAccounts,
    tenantInsert,
    tenantCreateField,
    samlTenantCreateField,
  };
}

export type AuthRenderingContext = ReturnType<typeof createAuthRenderingContext>;
