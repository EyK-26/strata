import {
  APP_PORT_CONFIG_KEY,
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  DEFAULT_APP_PORT,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
} from "../config";
import type { ServiceProvider } from "../contracts";

function parseIntegerEnv(
  envName: string,
  fallback: number,
  options: { minimum: number },
): number {
  const rawValue = process.env[envName];

  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed < options.minimum) {
    const comparison = options.minimum === 0 ? "a non-negative" : `an integer >= ${options.minimum}`;
    throw new Error(`${envName} must be ${comparison} value.`);
  }

  return parsed;
}

const configProvider: ServiceProvider = {
  name: "core.config",
  register({ container, config }) {
    container.set(CORE_CONFIG_TOKEN, config);
    config.set(
      APP_PORT_CONFIG_KEY,
      parseIntegerEnv("PORT", DEFAULT_APP_PORT, { minimum: 1 }),
    );
    config.set(
      CACHE_TTL_MS_CONFIG_KEY,
      parseIntegerEnv("CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS, { minimum: 0 }),
    );
    config.set(
      CACHE_MAX_ENTRIES_CONFIG_KEY,
      parseIntegerEnv("CACHE_MAX_ENTRIES", DEFAULT_CACHE_MAX_ENTRIES, {
        minimum: 1,
      }),
    );
  },
};

export default configProvider;
