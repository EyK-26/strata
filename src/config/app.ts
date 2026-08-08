interface AppConfig {
  name: string;
  env: string;
  debug: boolean;
  url: string;
  apiPrefix: string;
}

const appConfig: AppConfig = {
  name: "WorkHub",
  env: process.env.APP_ENV ?? "local",
  debug: (process.env.APP_DEBUG ?? "true") !== "false",
  url: process.env.APP_URL ?? "http://localhost:3000",
  apiPrefix: process.env.API_PREFIX ?? "/api/v1",
};

export { appConfig };
export type { AppConfig };
