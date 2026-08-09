const API_PREFIX = "/api/v1";

interface ApiErrorBody {
  error?: string;
  details?: Record<string, string[]>;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiFetchOptions extends RequestInit {
  token?: string | null;
  etag?: string | null;
}

async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  if (options.etag) {
    headers.set("if-match", options.etag);
  }

  if (options.body && !headers.has("content-type") && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  headers.set("cache-control", "no-cache");
  headers.set("pragma", "no-cache");

  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  if (response.status === 304) {
    const retryHeaders = new Headers(headers);
    retryHeaders.delete("if-none-match");
    retryHeaders.delete("if-modified-since");

    const retryResponse = await fetch(`${API_PREFIX}${path}`, {
      ...options,
      headers: retryHeaders,
      cache: "no-store",
    });

    return apiFetchFromResponse<T>(retryResponse);
  }

  return apiFetchFromResponse<T>(response);
}

async function apiFetchFromResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new ApiError(response.status, `Request failed with ${response.status}`);
    }

    return undefined as T;
  }

  const body = (await response.json()) as T & ApiErrorBody;

  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? "Request failed", body.details);
  }

  return body;
}

async function fetchResourceEtag(path: string, token: string): Promise<string> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, `Failed to load ETag for ${path}`);
  }

  const etag = response.headers.get("etag");

  if (!etag) {
    throw new ApiError(412, `Missing ETag for ${path}`);
  }

  return etag;
}

export type { ApiErrorBody };
export { API_PREFIX, ApiError, apiFetch, fetchResourceEtag };
