type EnvRecord = Record<string, string | undefined>;

/** App environments that are allowed to boot without production secret checks. */
const NON_PRODUCTION_APP_ENVS = new Set([
  "local",
  "development",
  "dev",
  "test",
  "testing",
  "staging",
  "ci",
]);

function normalizeEnvValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Production when APP_ENV or NODE_ENV says so. Unrecognized APP_ENV values
 * (for example "prod" or "Production" after case-folding fails to match
 * "production") default to production so secrets checks cannot be skipped by
 * capitalization or a typo.
 */
function isProductionEnv(env: EnvRecord = process.env): boolean {
  const appEnv = normalizeEnvValue(env.APP_ENV);
  const nodeEnv = normalizeEnvValue(env.NODE_ENV);

  if (appEnv === "production" || nodeEnv === "production") {
    return true;
  }

  if (appEnv === "") {
    return false;
  }

  return !NON_PRODUCTION_APP_ENVS.has(appEnv);
}

/** True only for the exact string "true". Unset, "false", "0", "FALSE", and "off" are off. */
function envFlagEnabled(value: string | undefined): boolean {
  return value === "true";
}

export type { EnvRecord };
export { envFlagEnabled, isProductionEnv, NON_PRODUCTION_APP_ENVS };
