import { resolveEnv } from "@getstrata/core/config/envSchema";
export interface ApplicationConfig {
  readonly port: number;
  readonly hostname?: string;
  readonly appUrl: string;
  readonly databaseUrl: string;
}
export function loadApplicationConfig(
  env: Readonly<Record<string, string | undefined>>,
): ApplicationConfig {
  const values = resolveEnv(
    {
      DATABASE_URL: { required: true },
      PORT: { integer: true, minimum: 0, maximum: 65535, default: "3000" },
    },
    { ...env, DATABASE_URL: env.APP_DATABASE_URL?.trim() || env.DATABASE_URL },
  );
  const appUrl = env.APP_URL ?? "http://localhost:3000";
  const url = new URL(appUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new TypeError("APP_URL must be an HTTP(S) URL without credentials.");
  return Object.freeze({
    port: values.PORT,
    hostname: env.HOST?.trim() || undefined,
    appUrl,
    databaseUrl: values.DATABASE_URL!,
  });
}
