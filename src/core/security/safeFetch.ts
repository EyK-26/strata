import { assertSafeOutboundUrl } from "./safeUrl.ts";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
}

async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? 0;
  const urlOptions = { allowHttp: options.allowHttp };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = assertSafeOutboundUrl(input, urlOptions).toString();
    let redirectCount = 0;

    while (true) {
      const response = await fetch(currentUrl, {
        ...init,
        signal: controller.signal,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (!location || redirectCount >= maxRedirects) {
          return response;
        }

        currentUrl = assertSafeOutboundUrl(
          new URL(location, currentUrl).toString(),
          urlOptions,
        ).toString();
        redirectCount += 1;
        continue;
      }

      return response;
    }
  } finally {
    clearTimeout(timeout);
  }
}

export type { SafeFetchOptions };
export { DEFAULT_FETCH_TIMEOUT_MS, safeFetch };
