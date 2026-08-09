type EnvRecord = Record<string, string | undefined>;

/**
 * App environments that may boot without production secret checks.
 * Staging is not in this set: it is typically internet-exposed with
 * production-like data, so it must use real secrets.
 */
const NON_PRODUCTION_APP_ENVS = new Set(["local", "development", "dev", "test", "testing", "ci"]);

function normalizeEnvValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Production when APP_ENV or NODE_ENV says so, including `staging`.
 * Unrecognized APP_ENV values (for example "prod" or "Production" after
 * case-folding fails to match "production") default to production so secrets
 * checks cannot be skipped by capitalization or a typo.
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
