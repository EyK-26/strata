interface LoginRateLimitConfig {
  maxAttempts: number;
  decaySeconds: number;
}

const LOCAL_LOGIN_RATE_LIMIT: LoginRateLimitConfig = {
  maxAttempts: 100,
  decaySeconds: 60,
};

const PRODUCTION_LOGIN_RATE_LIMIT: LoginRateLimitConfig = {
  maxAttempts: 5,
  decaySeconds: 900,
};

interface RateLimitEnvironment {
  readonly [key: string]: string | undefined;
  APP_ENV?: string;
  LOGIN_RATE_LIMIT_PER_WINDOW?: string;
  LOGIN_RATE_LIMIT_WINDOW_SECONDS?: string;
  LOGIN_RATE_LIMIT_WINDOW_MS?: string;
  REGISTER_RATE_LIMIT_PER_WINDOW?: string;
  REGISTER_RATE_LIMIT_WINDOW_SECONDS?: string;
  REGISTER_RATE_LIMIT_WINDOW_MS?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function parseWindowSeconds(
  secondsValue: string | undefined,
  msValue: string | undefined,
  fallback: number,
): number {
  if (secondsValue !== undefined && secondsValue.trim() !== "") {
    return parsePositiveInt(secondsValue, fallback);
  }

  if (msValue !== undefined && msValue.trim() !== "") {
    const parsedMs = Number(msValue);

    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.max(1, Math.trunc(parsedMs / 1000));
    }
  }

  return fallback;
}

function resolveLoginRateLimit(env: RateLimitEnvironment = {}): LoginRateLimitConfig {
  const defaults = env.APP_ENV === "local" ? LOCAL_LOGIN_RATE_LIMIT : PRODUCTION_LOGIN_RATE_LIMIT;

  return {
    maxAttempts: parsePositiveInt(env.LOGIN_RATE_LIMIT_PER_WINDOW, defaults.maxAttempts),
    decaySeconds: parseWindowSeconds(
      env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      env.LOGIN_RATE_LIMIT_WINDOW_MS,
      defaults.decaySeconds,
    ),
  };
}

function resolveRegisterRateLimit(env: RateLimitEnvironment = {}): LoginRateLimitConfig {
  const defaults =
    env.APP_ENV === "local"
      ? { maxAttempts: 100, decaySeconds: 60 }
      : { maxAttempts: 10, decaySeconds: 60 };

  return {
    maxAttempts: parsePositiveInt(env.REGISTER_RATE_LIMIT_PER_WINDOW, defaults.maxAttempts),
    decaySeconds: parseWindowSeconds(
      env.REGISTER_RATE_LIMIT_WINDOW_SECONDS,
      env.REGISTER_RATE_LIMIT_WINDOW_MS,
      defaults.decaySeconds,
    ),
  };
}

export type { LoginRateLimitConfig, RateLimitEnvironment };
export {
  LOCAL_LOGIN_RATE_LIMIT,
  PRODUCTION_LOGIN_RATE_LIMIT,
  resolveLoginRateLimit,
  resolveRegisterRateLimit,
};
