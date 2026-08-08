import {
  APP_PORT_CONFIG_KEY,
  CACHE_DRIVER_CONFIG_KEY,
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CONFIG_TOKEN,
  DATABASE_URL_CONFIG_KEY,
  DEFAULT_APP_PORT,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_CACHE_DRIVER,
  REDIS_URL_CONFIG_KEY,
} from "../config";
import { appConfigKeys, appEnvSchema } from "../env";
import { validateEnv } from "../../core/config/envSchema";
import type { ServiceProvider } from "../contracts";

function parseInteger(value: string, envName: string, minimum: number): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < minimum) {
    const comparison = minimum === 0 ? "a non-negative" : `an integer >= ${minimum}`;
    throw new Error(`${envName} must be ${comparison} value.`);
  }

  return parsed;
}

const configProvider: ServiceProvider = {
  name: "core.config",
  register({ container, config }) {
    const env = validateEnv(appEnvSchema);

    container.set(CORE_CONFIG_TOKEN, config);
    config.set(DATABASE_URL_CONFIG_KEY, env.DATABASE_URL!);
    config.set(
      APP_PORT_CONFIG_KEY,
      parseInteger(env.PORT ?? String(DEFAULT_APP_PORT), "PORT", 1),
    );
    config.set(
      CACHE_TTL_MS_CONFIG_KEY,
      parseInteger(
        env.CACHE_TTL_MS ?? String(DEFAULT_CACHE_TTL_MS),
        "CACHE_TTL_MS",
        0,
      ),
    );
    config.set(
      CACHE_MAX_ENTRIES_CONFIG_KEY,
      parseInteger(
        env.CACHE_MAX_ENTRIES ?? String(DEFAULT_CACHE_MAX_ENTRIES),
        "CACHE_MAX_ENTRIES",
        1,
      ),
    );
    config.set(
      CACHE_DRIVER_CONFIG_KEY,
      env.CACHE_DRIVER ?? DEFAULT_CACHE_DRIVER,
    );
    config.set(REDIS_URL_CONFIG_KEY, env.REDIS_URL ?? "");
  },
};

export default configProvider;
export { appConfigKeys };
