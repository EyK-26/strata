import { resolveCorsConfig } from "../core/http/corsMiddleware";

const corsConfig = {
  get allowedOrigins() {
    return resolveCorsConfig().allowedOrigins;
  },
  get allowedMethods() {
    return resolveCorsConfig().allowedMethods;
  },
  get allowedHeaders() {
    return resolveCorsConfig().allowedHeaders;
  },
  get maxAgeSeconds() {
    return resolveCorsConfig().maxAgeSeconds;
  },
};

export { corsConfig, resolveCorsConfig };
