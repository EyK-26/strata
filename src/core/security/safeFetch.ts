import { pinUrlToAddress, resolveSafeOutboundTarget } from "./safeUrl.ts";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
  resolveDns?: boolean;
  allowPrivate?: boolean;
}

type PinnedRequestInit = RequestInit & { tls?: { serverName: string } };

async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? 0;
  const resolveDns = options.resolveDns ?? true;
  const urlOptions = {
    allowHttp: options.allowHttp,
    resolveDns,
    allowPrivate: options.allowPrivate,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = await resolveSafeOutboundTarget(input, urlOptions);
    let redirectCount = 0;

    while (true) {
      const address = current.addresses[0];
      const fetchUrl = address
        ? pinUrlToAddress(current.url, address).toString()
        : current.url.toString();
      const headers = new Headers(init.headers);
      if (address && !headers.has("host")) {
        headers.set("Host", current.url.host);
      }

      const fetchInit: PinnedRequestInit = {
        ...init,
        headers,
        signal: controller.signal,
        redirect: "manual",
      };
      if (address) {
        fetchInit.tls = { serverName: current.url.hostname };
      }

      const response = await fetch(fetchUrl, fetchInit);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (!location || redirectCount >= maxRedirects) {
          return response;
        }

        current = await resolveSafeOutboundTarget(
          new URL(location, current.url).toString(),
          urlOptions,
        );
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
