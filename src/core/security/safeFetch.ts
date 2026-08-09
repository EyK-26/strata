const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
}

async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = input;
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

        currentUrl = new URL(location, currentUrl).toString();
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
