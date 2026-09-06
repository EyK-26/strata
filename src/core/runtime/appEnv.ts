type EnvRecord = Record<string, string | undefined>;

/** Production when either the framework or the Node convention says so. */
function isProductionEnv(env: EnvRecord = process.env): boolean {
  return env.APP_ENV === "production" || env.NODE_ENV === "production";
}

export { isProductionEnv };
