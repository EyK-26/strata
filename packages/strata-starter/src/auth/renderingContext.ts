import {
  authUsesJwt,
  authUsesToken,
  htmlAuthKit,
  type StarterLayers,
  usesTenantTable,
} from "../types.ts";

// Resolve existing selection policy once; fragments only render their owned artifact.
export function createAuthRenderingContext(layers: StarterLayers) {
  const cookie = htmlAuthKit(layers.auth);
  const github = Boolean(layers.extras.oauthGithub && cookie);
  const oidc = Boolean(layers.extras.oidc && cookie);
  const mfa = Boolean(layers.extras.mfa && cookie);
  const verify = Boolean(layers.extras.emailVerification);
  const bearerApi = authUsesToken(layers.auth) || authUsesJwt(layers.auth);
  const jsonCookieAccounts =
    cookie &&
    (layers.frontend === "api" || layers.frontend === "spa-react" || layers.frontend === "hybrid");
  const jsonAccounts = bearerApi || jsonCookieAccounts;
  const tenantInsert = usesTenantTable(layers.tenancy);
  const tenantCreateField = tenantInsert
    ? `
                tenant_id: currentTenantId(),`
    : "";
  const samlTenantCreateField = tenantInsert
    ? `
                  tenant_id: currentTenantId(),`
    : "";

  return {
    layers,
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
