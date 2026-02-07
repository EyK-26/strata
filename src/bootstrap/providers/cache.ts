import SimpleCache from "../../core/cache/simpleCache";
import {
  CACHE_MAX_ENTRIES_CONFIG_KEY,
  CACHE_TTL_MS_CONFIG_KEY,
  CORE_CACHE_TOKEN,
} from "../config";
import type { ServiceProvider } from "../contracts";

const cacheProvider: ServiceProvider = {
  name: "core.cache",
  register({ container, config, dependencies }) {
    container.singleton(
      CORE_CACHE_TOKEN,
      () =>
        new SimpleCache(
          config.require<number>(CACHE_TTL_MS_CONFIG_KEY),
          config.require<number>(CACHE_MAX_ENTRIES_CONFIG_KEY),
        ),
    );

    dependencies.cache = container.resolve(CORE_CACHE_TOKEN);
  },
};

export default cacheProvider;
