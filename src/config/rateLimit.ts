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

function isLocalAppEnv(): boolean {
  return (process.env.APP_ENV ?? "local") === "local";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function resolveLoginRateLimit(): LoginRateLimitConfig {
  const defaults = isLocalAppEnv() ? LOCAL_LOGIN_RATE_LIMIT : PRODUCTION_LOGIN_RATE_LIMIT;

  return {
    maxAttempts: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_PER_WINDOW, defaults.maxAttempts),
    decaySeconds: parsePositiveInt(
      process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      defaults.decaySeconds,
    ),
  };
}

function resolveRegisterRateLimit(): LoginRateLimitConfig {
  const defaults = isLocalAppEnv()
    ? { maxAttempts: 100, decaySeconds: 60 }
    : { maxAttempts: 10, decaySeconds: 60 };

  return {
    maxAttempts: parsePositiveInt(process.env.REGISTER_RATE_LIMIT_PER_WINDOW, defaults.maxAttempts),
    decaySeconds: parsePositiveInt(
      (process.env.REGISTER_RATE_LIMIT_WINDOW_SECONDS ?? process.env.REGISTER_RATE_LIMIT_WINDOW_MS)
        ? String(Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS) / 1000)
        : undefined,
      defaults.decaySeconds,
    ),
  };
}

export type { LoginRateLimitConfig };
export {
  LOCAL_LOGIN_RATE_LIMIT,
  PRODUCTION_LOGIN_RATE_LIMIT,
  resolveLoginRateLimit,
  resolveRegisterRateLimit,
};
