import type { AuthUser } from "../core/auth/authContext";

interface ActingAsOptions {
  token?: string;
}

interface TestHttpState {
  user: AuthUser | null;
  token: string | null;
}

const state: TestHttpState = {
  user: null,
  token: null,
};

function actingAs(user: AuthUser | null, options: ActingAsOptions = {}): void {
  state.user = user;
  state.token = options.token ?? null;
}

function resetActingAs(): void {
  state.user = null;
  state.token = null;
}

function actingAsHeaders(): Record<string, string> {
  if (state.token) {
    return {
      authorization: `Bearer ${state.token}`,
    };
  }

  if (!state.user) {
    return {};
  }

  const headers: Record<string, string> = {
    "x-authenticated-user-id": String(state.user.id),
  };

  if (state.user.role) {
    headers["x-authenticated-user-role"] = state.user.role;
  }

  return headers;
}

function mergeHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);

  for (const [key, value] of Object.entries(actingAsHeaders())) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return headers;
}

async function postJson(url: string, body: unknown, init?: RequestInit): Promise<Response> {
  const headers = mergeHeaders(init);
  headers.set("content-type", "application/json");

  return fetch(url, {
    ...init,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function postForm(
  url: string,
  data: Record<string, string>,
  init?: RequestInit,
): Promise<Response> {
  const headers = mergeHeaders(init);
  headers.set("content-type", "application/x-www-form-urlencoded");

  return fetch(url, {
    ...init,
    method: "POST",
    headers,
    body: new URLSearchParams(data),
  });
}

export type { ActingAsOptions, TestHttpState };
export { actingAs, actingAsHeaders, mergeHeaders, postForm, postJson, resetActingAs, state };
