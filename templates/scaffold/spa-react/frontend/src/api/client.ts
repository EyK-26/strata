import { AUTH_CONFIG } from "../auth/config";

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
  etag?: string | null;
}
interface AuthUser {
  id: number | string;
  name?: string;
  email?: string;
  role: string;
}
let csrfToken: string | null = null;
let bearer: string | null = null;
let developmentIdentity: AuthUser | null = null;
const invalidationListeners = new Set<() => void>();
function onAuthInvalidated(listener: () => void) {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}
function clearAuthentication() {
  bearer = null;
  developmentIdentity = null;
  csrfToken = null;
  for (const listener of invalidationListeners) listener();
}
function authHeaders(headers: Headers) {
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (AUTH_CONFIG.transport === "headers" && developmentIdentity) {
    headers.set("x-authenticated-user-id", String(developmentIdentity.id));
    headers.set("x-authenticated-user-role", developmentIdentity.role);
  }
}
async function resolveCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_PREFIX}/auth/csrf`, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "Could not load a CSRF token.");
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new ApiError(502, "The CSRF response did not include a token.");
  csrfToken = body.token;
  return csrfToken;
}
async function request(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? "GET").toUpperCase();
  authHeaders(headers);
  if (options.etag) headers.set("if-match", options.etag);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (AUTH_CONFIG.transport !== "headers" && method !== "GET" && method !== "HEAD")
    headers.set("x-csrf-token", await resolveCsrfToken());
  const response = await fetch(path, { ...options, credentials: "include", headers });
  const next = response.headers.get("x-csrf-token");
  if (next) csrfToken = next;
  if (response.status === 401) clearAuthentication();
  return response;
}
async function requestJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) return undefined as T;
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    throw new ApiError(response.status, `Expected JSON from ${path}; received ${response.status}.`);
  }
  const body = (await response.json()) as T & ApiErrorBody;
  if (!response.ok)
    throw new ApiError(response.status, body.error ?? "Request failed", body.details);
  return body;
}
async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return requestJson<T>(`${API_PREFIX}${path}`, options);
}
async function fetchResourceEtag(path: string): Promise<string> {
  const response = await request(`${API_PREFIX}${path}`);
  if (!response.ok) throw new ApiError(response.status, `Failed to load ETag for ${path}`);
  const etag = response.headers.get("etag");
  if (!etag) throw new ApiError(412, `Missing ETag for ${path}`);
  return etag;
}
async function loadProfile(): Promise<AuthUser | null> {
  if (AUTH_CONFIG.transport === "headers") return developmentIdentity;
  if ((AUTH_CONFIG.transport === "token" || AUTH_CONFIG.transport === "jwt") && !bearer)
    return null;
  return requestJson<AuthUser>(
    AUTH_CONFIG.transport === "jwt" ? "/api/user" : `${API_PREFIX}/auth/me`,
  );
}
async function signIn(email: string, password: string, mfaCode?: string): Promise<AuthUser> {
  if (AUTH_CONFIG.transport === "headers")
    throw new ApiError(400, "Use a development identity instead.");
  const payload = await requestJson<{ token?: string }>(
    AUTH_CONFIG.transport === "jwt" ? "/api/auth/token" : `${API_PREFIX}/auth/login`,
    {
      method: "POST",
      body: JSON.stringify({ email, password, ...(mfaCode ? { mfa_code: mfaCode } : {}) }),
    },
  );
  if (AUTH_CONFIG.transport === "token" || AUTH_CONFIG.transport === "jwt") {
    if (!payload.token)
      throw new ApiError(502, "Login did not return the selected bearer credential.");
    bearer = payload.token;
  }
  try {
    const profile = await loadProfile();
    if (!profile) throw new ApiError(401, "Login did not establish an identity.");
    return profile;
  } catch (error) {
    clearAuthentication();
    throw error;
  }
}
function selectDevelopmentIdentity(id: string, role: string): AuthUser {
  if (
    AUTH_CONFIG.transport !== "headers" ||
    !/^\d+$/.test(id) ||
    Number(id) <= 0 ||
    !["member", "admin"].includes(role)
  )
    throw new ApiError(422, "Choose a positive user ID and a supported role.");
  developmentIdentity = { id, role };
  return developmentIdentity;
}
async function signOut(): Promise<void> {
  // Bearer logout drops this browser's memory; server revocation remains the account API's contract.
  if (AUTH_CONFIG.transport === "cookie") await apiFetch("/auth/logout", { method: "POST" });
  clearAuthentication();
}

export type { ApiErrorBody, AuthUser };
export {
  API_PREFIX,
  ApiError,
  apiFetch,
  fetchResourceEtag,
  loadProfile,
  onAuthInvalidated,
  selectDevelopmentIdentity,
  signIn,
  signOut,
};
