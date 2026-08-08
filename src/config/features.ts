interface FeatureFlags {
  webhooks: boolean;
  fullTextSearch: boolean;
  auditLog: boolean;
  oauthLogin: boolean;
  samlLogin: boolean;
}

const featureFlags: FeatureFlags = {
  webhooks: (process.env.FEATURE_WEBHOOKS ?? "true") !== "false",
  fullTextSearch: (process.env.FEATURE_SEARCH ?? "true") !== "false",
  auditLog: (process.env.FEATURE_AUDIT_LOG ?? "true") !== "false",
  oauthLogin: (process.env.FEATURE_OAUTH ?? "true") !== "false",
  samlLogin: (process.env.FEATURE_SAML ?? "false") === "true",
};

function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return featureFlags[feature];
}

export { featureFlags, isFeatureEnabled };
export type { FeatureFlags };
