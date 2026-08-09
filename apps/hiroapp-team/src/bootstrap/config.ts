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
