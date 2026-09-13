import { restoreEnvVar } from "./restoreEnv";

const envSnapshots: Array<{ appEnv: string | undefined; nodeEnv: string | undefined }> = [];

function enableDevAuthHeaders(): string | undefined {
  const previous = process.env.AUTH_DEV_HEADERS;
  envSnapshots.push({ appEnv: process.env.APP_ENV, nodeEnv: process.env.NODE_ENV });
  process.env.AUTH_DEV_HEADERS = "true";
  process.env.APP_ENV = "local";
  if (process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "test";
  }
  return previous;
}

function restoreDevAuthHeaders(previous: string | undefined): void {
  restoreEnvVar("AUTH_DEV_HEADERS", previous);
  const snapshot = envSnapshots.pop();
  if (snapshot) {
    restoreEnvVar("APP_ENV", snapshot.appEnv);
    restoreEnvVar("NODE_ENV", snapshot.nodeEnv);
  }
}

export { enableDevAuthHeaders, restoreDevAuthHeaders };
