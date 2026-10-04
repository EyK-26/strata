import { pinUrlToAddress, resolveSafeOutboundTarget } from "./safeUrl.ts";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

interface SafeFetchOptions {
  /** One deadline covering DNS, redirects, headers, and response body consumption. */
  timeoutMs?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
  resolveDns?: boolean;
  allowPrivate?: boolean;
}

type PinnedRequestInit = RequestInit & { tls?: { serverName: string } };

/** Also bounds stages (such as DNS) which cannot consume an AbortSignal themselves. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function preserveResponseMetadata(response: Response, original: Response): Response {
  Object.defineProperties(response, {
    url: { value: original.url },
    redirected: { value: original.redirected },
    type: { value: original.type },
  });
  const clone = response.clone.bind(response);
  response.clone = () => preserveResponseMetadata(clone() as Response, original);
  return response;
}

/** Keep the deadline alive until EOF, cancellation, failure, or an unread-body timeout. */
function withBodyDeadline(response: Response, signal: AbortSignal, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  let stopped = false;
  let bodyController: ReadableStreamDefaultController<Uint8Array>;
  const stop = (reason: unknown, errorBody: boolean) => {
    if (stopped) return;
    stopped = true;
    release();
    signal.removeEventListener("abort", onAbort);
    if (errorBody) bodyController.error(reason);
    // Cancellation releases transport resources even when the caller never reads the body.
    void reader
      .cancel(reason)
      .catch(() => {})
      .finally(() => reader.releaseLock());
  };
  const onAbort = () => stop(signal.reason, true);
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        bodyController = controller;
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      },
      async pull(controller) {
        try {
          const result = await untilAborted(reader.read(), signal);
          if (stopped) return;
          if (result.done) {
            stopped = true;
            release();
            signal.removeEventListener("abort", onAbort);
            reader.releaseLock();
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          stop(error, true);
        }
      },
      cancel(reason) {
        stop(reason, false);
      },
    },
    { highWaterMark: 0 },
  );
  return preserveResponseMetadata(
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    response,
  );
}

async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  init.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("safeFetch timeoutMs must be a positive finite number.");
  }
  const maxRedirects = options.maxRedirects ?? 0;
  const urlOptions = {
    allowHttp: options.allowHttp,
    resolveDns: options.resolveDns ?? true,
    allowPrivate: options.allowPrivate,
  };
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    timeoutMs,
  );
  const release = () => {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", forwardAbort);
  };

  try {
    let current = await untilAborted(
      resolveSafeOutboundTarget(input, urlOptions),
      controller.signal,
    );
    let redirectCount = 0;

    while (true) {
      controller.signal.throwIfAborted();
      const address = current.addresses[0];
      const fetchUrl = address
        ? pinUrlToAddress(current.url, address).toString()
        : current.url.toString();
      const headers = new Headers(init.headers);
      if (address && !headers.has("host")) headers.set("Host", current.url.host);
      const fetchInit: PinnedRequestInit = {
        ...init,
        headers,
        signal: controller.signal,
        redirect: "manual",
      };
      if (address) fetchInit.tls = { serverName: current.url.hostname };
      const response = await untilAborted(fetch(fetchUrl, fetchInit), controller.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location && redirectCount < maxRedirects) {
          if (response.body) await untilAborted(response.body.cancel(), controller.signal);
          current = await untilAborted(
            resolveSafeOutboundTarget(new URL(location, current.url).toString(), urlOptions),
            controller.signal,
          );
          redirectCount++;
          continue;
        }
      }
      return withBodyDeadline(response, controller.signal, release);
    }
  } catch (error) {
    controller.abort(error);
    release();
    throw error;
  }
}

export type { SafeFetchOptions };
export { DEFAULT_FETCH_TIMEOUT_MS, safeFetch };
