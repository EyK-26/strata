export interface AppConfig {
  port: number;
  appUrl: string;
  databaseUrl: string;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    databaseUrl,
  };
}

/** Cookie sessions and signed cookies are keyed by this; there is no default. */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required. Copy .env.example to .env and set it (32+ characters).",
    );
  }
  return secret;
}
