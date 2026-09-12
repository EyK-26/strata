import { restoreEnvVar } from "./restoreEnv";

function enableDevAuthHeaders(): string | undefined {
  const previous = process.env.AUTH_DEV_HEADERS;
  process.env.AUTH_DEV_HEADERS = "true";
  return previous;
}

function restoreDevAuthHeaders(previous: string | undefined): void {
  restoreEnvVar("AUTH_DEV_HEADERS", previous);
}

export { enableDevAuthHeaders, restoreDevAuthHeaders };
