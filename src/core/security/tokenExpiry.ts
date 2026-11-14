import { resolveEnv } from "../config/envSchema";

function resolveDefaultTokenExpiryDays(value?: string): number | null {
  return (
    resolveEnv(
      { API_TOKEN_DEFAULT_EXPIRY_DAYS: { integer: true, minimum: 1 } },
      { API_TOKEN_DEFAULT_EXPIRY_DAYS: value },
    ).API_TOKEN_DEFAULT_EXPIRY_DAYS ?? null
  );
}

export { resolveDefaultTokenExpiryDays };
