interface AppConfig {
  name: string;
  env: string;
  debug: boolean;
  url: string;
  apiPrefix: string;
}

const appConfig: AppConfig = {
  name: process.env.APP_NAME?.trim() || "WorkHub",
  env: process.env.APP_ENV ?? "local",
  debug: (process.env.APP_DEBUG ?? "true") !== "false",
  url: process.env.APP_URL ?? "http://localhost:3000",
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
};

export type { AppConfig };
export { appConfig };
