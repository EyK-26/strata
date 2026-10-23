import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";
import { generateTotp } from "@getstrata/core/security/totp";

const appDir = process.cwd();
const layers = JSON.parse(await Bun.file(resolve(appDir, "strata.layers.json")).text()).layers;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const codes = new Map<string, URLSearchParams>();
const email = `oidc-customer-${Date.now()}@example.test`;
const password = "CommerceOidc!Password1";
let origin = "",
  issuer = "",
  tokenRequests = 0,
  jwksRequests = 0;
const protocolErrors: string[] = [];
type Evidence = {
  label: string;
  status: number;
  location: string | null;
  cookieNames: Array<string | undefined>;
  error?: unknown;
  bodyExcerpt?: string;
};
const evidence: Evidence[] = [];
function required(value: string | null | undefined): string {
  assert.ok(value, "Required protocol field is absent");
  return value;
}
function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  assert.equal(typeof field, "string", key);
  assert.ok(typeof field === "string" && field.length > 0);
  return field;
}
const idp = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      if (url.pathname === "/jwks") {
        jwksRequests++;
        return Response.json({
          keys: [
            {
              ...publicKey.export({ format: "jwk" }),
              kid: "ordinary-fixture",
              alg: "RS256",
              use: "sig",
            },
          ],
        });
      }
      if (url.pathname === "/authorize") {
        const p = url.searchParams;
        assert.equal(p.get("client_id"), "ordinary-fixture-client");
        assert.equal(p.get("redirect_uri"), `${origin}/auth/oidc/callback`);
        assert.equal(p.get("response_type"), "code");
        assert.equal(p.get("code_challenge_method"), "S256");
        assert.ok(p.get("nonce"));
        assert.ok(p.get("state"));
        assert.ok(p.get("code_challenge"));
        const code = crypto.randomUUID();
        codes.set(code, new URLSearchParams(p));
        return Response.redirect(
          `${origin}/auth/oidc/callback?${new URLSearchParams({ code, state: required(p.get("state")) })}`,
          302,
        );
      }
      if (url.pathname === "/token") {
        tokenRequests++;
        const body = new URLSearchParams(await request.text());
        assert.equal(request.method, "POST");
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("client_id"), "ordinary-fixture-client");
        assert.equal(body.get("client_secret"), "ordinary-local-fixture-secret");
        assert.equal(body.get("redirect_uri"), `${origin}/auth/oidc/callback`);
        const code = required(body.get("code"));
        const p = codes.get(code);
        assert.ok(p);
        codes.delete(code);
        assert.equal(
          createHash("sha256")
            .update(required(body.get("code_verifier")))
            .digest("base64url"),
          p.get("code_challenge"),
        );
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          iss: issuer,
          aud: "ordinary-fixture-client",
          sub: "owned-customer",
          iat: now,
          exp: now + 120,
          nonce: p.get("nonce"),
          email,
          email_verified: true,
          name: "Order Customer",
          at_hash: createHash("sha256")
            .update("owned-access-token")
            .digest()
            .subarray(0, 16)
            .toString("base64url"),
        };
        const encoded = [{ alg: "RS256", typ: "JWT", kid: "ordinary-fixture" }, payload]
          .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
          .join(".");
        const signature = sign("RSA-SHA256", Buffer.from(encoded), privateKey).toString(
          "base64url",
        );
        return Response.json({
          access_token: "owned-access-token",
          token_type: "Bearer",
          id_token: `${encoded}.${signature}`,
        });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      protocolErrors.push(String(error));
      return new Response("Fixture protocol assertion failed", { status: 500 });
    }
  },
});
issuer = `http://127.0.0.1:${idp.port}`;
Object.assign(process.env, {
  APP_ENV: "local",
  APP_URL: "http://localhost:3000",
  FEATURE_OAUTH: "true",
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: "ordinary-fixture-client",
  OIDC_CLIENT_SECRET: "ordinary-local-fixture-secret",
});
const { bootstrapApp, createAppServer } = await import(
  resolve(appDir, "src/bootstrap/createApp.ts")
);
const { closeDatabase } = await import(resolve(appDir, "src/bootstrap/database.ts"));
const app = await bootstrapApp({ migrate: false });
const server = createAppServer(app.routes, 0, undefined, { hostname: "127.0.0.1" });
origin = server.url.origin;
process.env.APP_URL = origin;
process.env.OIDC_REDIRECT_URI = `${origin}/auth/oidc/callback`;
const jar = new Map<string, string>();
let csrf = "";
async function request(label: string, path: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = {
    accept: "text/html",
    origin,
    cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
  if (csrf) headers["x-csrf-token"] = csrf;
  if (body !== undefined)
    headers["content-type"] =
      body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json";
  const response = await fetch(new URL(path, origin), {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof URLSearchParams
          ? body
          : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const nv = required(cookie.split(";")[0]);
    const at = nv.indexOf("=");
    const key = nv.slice(0, at),
      value = nv.slice(at + 1);
    if (value) jar.set(key, value);
    else jar.delete(key);
  }
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      json = parsed as Record<string, unknown>;
  } catch {
    /* HTML responses intentionally have no JSON body. */
  }
  const row = {
    label,
    status: response.status,
    location: response.headers.get("location"),
    cookieNames: response.headers.getSetCookie().map((v) => v.split("=")[0]),
    ...(json?.error ? { error: json.error } : {}),
    ...(response.status === 404 ? { bodyExcerpt: text.slice(0, 250) } : {}),
  };
  evidence.push(row);
  return { response, text, json, row };
}
async function signIn(label: string) {
  const start = await request(`${label}-start`, "/auth/oidc");
  assert.equal(start.response.status, 302, start.text);
  const authorize = await fetch(required(start.response.headers.get("location")), {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(authorize.status, 302);
  await authorize.text();
  return request(`${label}-callback`, required(authorize.headers.get("location")));
}
try {
  const csrfReply = await request("csrf", "/api/v1/auth/csrf");
  assert.equal(csrfReply.response.status, 200);
  csrf = stringField(csrfReply.json, "token");
  const register = await request("register", "/api/v1/auth/register", "POST", {
    name: "Order Customer",
    email,
    password,
  });
  assert.equal(register.response.status, 201, register.text);
  const ordinary = await signIn("without-mfa");
  assert.equal(ordinary.response.status, 302, ordinary.text);
  const profile = await request("without-mfa-profile", "/api/v1/auth/me");
  assert.equal(profile.response.status, 200);
  assert.equal(profile.json.email, email);
  const setup = await request("mfa-setup", "/api/v1/auth/mfa");
  assert.equal(setup.response.status, 200, setup.text);
  const secret = stringField(setup.json, "secret");
  const confirmed = await request("password-confirm", "/api/v1/auth/confirm-password", "POST", {
    password,
  });
  assert.equal(confirmed.response.status, 200, confirmed.text);
  const enrolled = await request("mfa-enroll", "/api/v1/auth/mfa", "POST", {
    secret: secret,
    code: generateTotp(secret),
  });
  assert.equal(enrolled.response.status, 200, enrolled.text);
  assert.ok(Array.isArray(enrolled.json.recoveryCodes) && enrolled.json.recoveryCodes.length > 0);
  await request("logout", "/api/v1/auth/logout", "POST", {});
  const mfa = await signIn("with-mfa");
  assert.equal(mfa.response.status, 302, mfa.text);
  const pendingProfile = await request("pending-profile", "/api/v1/auth/me");
  assert.equal(pendingProfile.response.status, 401, "Pending MFA must not authenticate the user");
  const destination = required(mfa.response.headers.get("location"));
  const challenge = await request("with-mfa-follow-redirect", destination);
  assert.equal(challenge.response.status, 200, "SSO must lead to a reachable MFA challenge");
  if (layers.frontend === "api" || layers.frontend === "spa-react") {
    assert.equal(
      (await request("general-web-login-stays-disabled", "/login")).response.status,
      404,
    );
  }
  if (challenge.response.status === 200) {
    csrf = challenge.text.match(/name="_token" value="([^"]+)"/)?.[1] ?? csrf;
    const noCsrf = await fetch(new URL(destination, origin), {
      method: "POST",
      headers: {
        origin,
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ code: generateTotp(secret) }),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(noCsrf.status, 403, await noCsrf.text());
    assert.equal((await request("missing-csrf-profile", "/api/v1/auth/me")).response.status, 401);
    const rejected = await request(
      "invalid-factor",
      destination,
      "POST",
      new URLSearchParams({ _token: csrf, code: "not-a-code" }),
    );
    assert.equal(rejected.response.status, 200, rejected.text);
    assert.equal((await request("invalid-factor-profile", "/api/v1/auth/me")).response.status, 401);
    const completed = await request(
      "mfa-challenge-submit",
      destination,
      "POST",
      new URLSearchParams({ _token: csrf, code: generateTotp(secret) }),
    );
    assert.equal(completed.response.status, 302, completed.text);
    const result = await request("with-mfa-profile", "/api/v1/auth/me");
    assert.equal(result.response.status, 200, result.text);
    assert.equal(result.json.email, email);
  }
  assert.deepEqual(protocolErrors, []);
  assert.equal(tokenRequests, 2);
  assert.ok(jwksRequests >= 1);
  console.log(
    "OIDC_JOURNEY " +
      JSON.stringify({
        packageVersion: JSON.parse(
          await Bun.file(resolve(appDir, "node_modules/@getstrata/core/package.json")).text(),
        ).version,
        frontend: layers.frontend,
        evidence,
        tokenRequests,
        jwksRequests,
        protocolErrors,
        callbackDestination: destination,
        challengeStatus: challenge.response.status,
      }),
  );
} finally {
  server.stop(true);
  idp.stop(true);
  await app.context.dispose();
  await closeDatabase();
}
