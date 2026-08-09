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

function resolveLoginRateLimit(): LoginRateLimitConfig {
  const defaults = isLocalAppEnv() ? LOCAL_LOGIN_RATE_LIMIT : PRODUCTION_LOGIN_RATE_LIMIT;

  return {
    maxAttempts: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_PER_WINDOW, defaults.maxAttempts),
    decaySeconds: parseWindowSeconds(
      process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
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
    decaySeconds: parseWindowSeconds(
      process.env.REGISTER_RATE_LIMIT_WINDOW_SECONDS,
      process.env.REGISTER_RATE_LIMIT_WINDOW_MS,
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
