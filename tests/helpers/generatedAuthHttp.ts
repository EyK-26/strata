import assert from "node:assert/strict";
import { jsonCsrfHeaders, mergeCookies } from "./jsonCsrf.ts";

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
}

/** Real generated routes only: fixture cookies are transported, never manufactured. */
export async function verifyGeneratedAuthHttp(origin: string, requestHost?: string) {
  const credentials = { email: "demo@example.com", password: "StrataDemo!ChangeMe" };
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      headers: { ...init.headers, ...(requestHost ? { host: requestHost } : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  const denied = await request("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: requestHost ? `${new URL(origin).protocol}//${requestHost}` : origin,
    },
    body: JSON.stringify(credentials),
  });
  assert.equal(denied.status, 403, "Native login must require CSRF.");
  await denied.text();
  const loginPage = await request("/login");
  assert.equal(loginPage.status, 200);
  assert.equal(loginPage.headers.get("cache-control"), "private, no-store");
  await loginPage.text();
  const csrfResponse = await request("/api/v1/auth/csrf");
  assert.equal(csrfResponse.status, 200);
  assert.equal(csrfResponse.headers.get("cache-control"), "private, no-store");
  await csrfResponse.text();
  const csrf = await jsonCsrfHeaders(origin, "", requestHost);
  const wrong = await request("/api/v1/auth/login", {
    method: "POST",
    headers: csrf.headers,
    body: JSON.stringify({ ...credentials, password: "Wrong!Password123" }),
  });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.headers.get("cache-control"), "private, no-store");
  await wrong.text();
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    headers: csrf.headers,
    body: JSON.stringify(credentials),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("cache-control"), "private, no-store");
  const body = await login.json();
  assertObject(body);
  assert.ok(typeof body.token === "string");
  assert.ok(body.token.startsWith("strp_"));
  const cookie = mergeCookies(login, csrf.cookie);
  async function me(headers: Record<string, string>, status: number) {
    const response = await request("/api/v1/auth/me", { headers });
    assert.equal(response.status, status);
    assert.equal(
      response.headers.get("cache-control"),
      status === 200 ? "private, no-store" : "no-store",
    );
    const data = await response.json();
    assertObject(data);
    if (status === 200) {
      assert.equal(data.email, credentials.email);
      assert.equal(data.role, "member");
      assert.deepEqual(Object.keys(data).sort(), ["email", "id", "name", "role"]);
    }
    return data;
  }
  await me({}, 401);
  await me({ cookie }, 200);
  await me({ authorization: `Bearer ${body.token}` }, 200);
  await me({ authorization: `Basic ${btoa(`${credentials.email}:${credentials.password}`)}` }, 200);
  const minted = await request("/api/auth/token", {
    method: "POST",
    headers: csrf.headers,
    body: JSON.stringify(credentials),
  });
  assert.equal(minted.status, 200);
  assert.equal(minted.headers.get("cache-control"), "private, no-store");
  const jwt = await minted.json();
  assertObject(jwt);
  assert.ok(typeof jwt.token === "string");
  assert.equal(jwt.token.split(".").length, 3);
  await me({ authorization: `Bearer ${jwt.token}` }, 200);
  await me({ authorization: "Bearer invalid", cookie }, 401);
  const logout = await request("/api/v1/auth/logout", {
    method: "POST",
    headers: { ...csrf.headers, cookie },
    body: "{}",
  });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await logout.json(), { ok: true });
  await me({ cookie: mergeCookies(logout, cookie) }, 401);
  // Session logout is not account suspension: separately issued credentials retain their contract.
  await me({ authorization: `Bearer ${body.token}` }, 200);
  await me({ authorization: `Bearer ${jwt.token}` }, 200);
  for (const path of ["/auth/github", "/auth/oidc", "/auth/saml"]) {
    const response = await request(path);
    assert.equal(response.status, 404, `Disabled provider route admitted ${path}`);
    await response.text();
  }
}

export async function verifyGeneratedScimHttp(origin: string, requestHost?: string) {
  const token = (tenant: number) => `q01-scim-tenant-${tenant}`;
  const request = (tenant: number, path: string, init: RequestInit = {}) =>
    fetch(`${origin}/scim/v2${path}`, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/scim+json",
        authorization: `Bearer ${token(tenant)}`,
        "x-tenant-id": String(tenant === 1 ? 2 : 1),
        ...(requestHost ? { host: requestHost } : {}),
        ...init.headers,
      },
    });
  const create = await request(2, "/Users", {
    method: "POST",
    body: JSON.stringify({
      userName: "other-tenant@example.test",
      displayName: "Other tenant",
      active: true,
    }),
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  assertObject(created);
  assert.ok(typeof created.id === "string");
  assert.equal(created.userName, "other-tenant@example.test");
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const tenant of [1, 2]) {
      const response = await request(tenant, "/Users");
      assert.equal(response.status, 200);
      const list = await response.json();
      assertObject(list);
      assert.ok(Array.isArray(list.Resources));
      assert.equal(
        list.Resources.some((row: { id: string }) => row.id === created.id),
        tenant === 2,
      );
      assert.equal(list.totalResults, tenant === 1 ? 2 : 1);
    }
  }
  const foreign = await request(1, `/Users/${created.id}`);
  assert.equal(foreign.status, 404);
  await foreign.text();
  const remove = await request(2, `/Users/${created.id}`, { method: "DELETE" });
  assert.equal(remove.status, 204);
  await remove.text();
}
