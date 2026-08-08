interface FeatureFlags {
  webhooks: boolean;
  fullTextSearch: boolean;
  auditLog: boolean;
  oauthLogin: boolean;
  samlLogin: boolean;
  scim: boolean;
  billing: boolean;
  siemExport: boolean;
  publicReads: boolean;
  emailVerification: boolean;
  mfa: boolean;
}

function readFeatureFlags(): FeatureFlags {
  return {
    webhooks: (process.env.FEATURE_WEBHOOKS ?? "true") !== "false",
    fullTextSearch: (process.env.FEATURE_SEARCH ?? "true") !== "false",
    auditLog: (process.env.FEATURE_AUDIT_LOG ?? "true") !== "false",
    oauthLogin: (process.env.FEATURE_OAUTH ?? "true") !== "false",
    samlLogin: (process.env.FEATURE_SAML ?? "false") === "true",
    scim: (process.env.FEATURE_SCIM ?? "true") !== "false",
    billing: (process.env.FEATURE_BILLING ?? "true") !== "false",
    siemExport: (process.env.FEATURE_SIEM_EXPORT ?? "true") !== "false",
    publicReads: (process.env.FEATURE_PUBLIC_READS ?? "true") !== "false",
    emailVerification: (process.env.FEATURE_EMAIL_VERIFICATION ?? "false") === "true",
    mfa: (process.env.FEATURE_MFA ?? "false") === "true",
  };
}

const featureFlags: FeatureFlags = readFeatureFlags();

function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return readFeatureFlags()[feature];
}

export type { FeatureFlags };
export { featureFlags, isFeatureEnabled, readFeatureFlags };
