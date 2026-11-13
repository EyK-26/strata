import { expect, mock, test } from "bun:test";
import { signJwt, verifyJwt } from "@getstrata/core/auth/jwt";
import { createOidcClient } from "@getstrata/core/auth/oauth/oidcIdToken";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import { createSessionCookie, readSession } from "@getstrata/core/auth/sessionCookie";
import { resetDnsLookupForTests, setDnsLookupForTests } from "@getstrata/core/security/safeUrl";
import { restoreEnvVar } from "../helpers/restoreEnv";

test("JWT signing rejects absent or whitespace owner secrets even when an ambient secret exists", () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "ambient-secret-must-not-be-selected";
  try {
    for (const secret of [undefined, "", "   "]) {
      expect(() => signJwt({ sub: 7 }, { secret: secret as never })).toThrow(
        "Explicit JWT secret is required.",
      );
    }
    const token = signJwt({ sub: 7 }, { secret: "explicit-owner-secret" });
    expect(verifyJwt(token, "explicit-owner-secret")?.sub).toBe(7);
    expect(verifyJwt(token, process.env.JWT_SECRET)).toBeNull();
  } finally {
    restoreEnvVar("JWT_SECRET", previous);
  }
});

test("session and password-confirmation writers reject missing owner keys instead of using ambient credentials", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "ambient-session-key-must-not-be-selected";
  const config = {
    cookieName: "owner_session",
    ttlSeconds: 300,
    rememberTtlSeconds: 600,
    production: false,
    secret: "explicit-session-key",
  };
  const confirmation = { ...config, cookieName: "owner_confirm" };
  try {
    expect(() => createSessionCookie(7, {}, { ...config, secret: undefined as never })).toThrow(
      "Explicit session secret is required.",
    );
    expect(() =>
      createPasswordConfirmCookie(7, undefined, { ...confirmation, secret: undefined as never }),
    ).toThrow("Explicit password confirmation secret is required.");
    const session = createSessionCookie(7, {}, config).split(";")[0] ?? "";
    expect(
      readSession(new Request("http://fixture", { headers: { cookie: session } }), config)?.userId,
    ).toBe(7);
    const confirmed = createPasswordConfirmCookie(7, undefined, confirmation).split(";")[0] ?? "";
    expect(
      hasFreshPasswordConfirmation(
        new Request("http://fixture", { headers: { cookie: confirmed } }),
        7,
        undefined,
        confirmation,
      ),
    ).toBe(true);
  } finally {
    restoreEnvVar("SESSION_SECRET", previous);
  }
});

test("OIDC client rejects malformed captured network policies before outbound requests", () => {
  for (const policy of [{ production: "false" }, { production: false, allowPrivate: "true" }, {}]) {
    expect(() => createOidcClient(policy as never)).toThrow(
      "OIDC requires an explicit valid network policy.",
    );
  }
  const policy = { production: true, allowPrivate: false };
  const client = createOidcClient(policy);
  policy.production = false;
  policy.allowPrivate = true;
  expect(client.fetchOptions("http://127.0.0.1/token")).toMatchObject({
    production: true,
    allowHttp: false,
    allowPrivate: false,
  });
});

test("OIDC discovery rejects malformed endpoints and exposes an immutable validated cache entry", async () => {
  const originalFetch = globalThis.fetch;
  const issuer = "https://issuer.example.test";
  const valid = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  };
  setDnsLookupForTests(async () => [{ address: "1.1.1.1", family: 4 }]);
  try {
    for (const document of [
      null,
      [],
      {},
      { ...valid, authorization_endpoint: undefined },
      { ...valid, token_endpoint: " " },
      { ...valid, jwks_uri: 7 },
    ]) {
      globalThis.fetch = mock(async () => Response.json(document)) as unknown as typeof fetch;
      await expect(createOidcClient({ production: true }).loadDiscovery(issuer)).rejects.toThrow(
        "OIDC discovery document did not include",
      );
    }
    let requests = 0;
    globalThis.fetch = mock(async () => {
      requests++;
      return Response.json({ ...valid, token_endpoint: `  ${valid.token_endpoint}  ` });
    }) as unknown as typeof fetch;
    const client = createOidcClient({ production: true });
    const discovery = await client.loadDiscovery(issuer);
    expect(discovery.token_endpoint).toBe(valid.token_endpoint);
    expect(Object.isFrozen(discovery)).toBe(true);
    expect(
      Reflect.set(discovery, "authorization_endpoint", "https://attacker.test/authorize"),
    ).toBe(false);
    expect(await client.loadDiscovery(`${issuer}/`)).toBe(discovery);
    expect((await client.loadDiscovery(issuer)).authorization_endpoint).toBe(
      valid.authorization_endpoint,
    );
    expect(requests).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    resetDnsLookupForTests();
  }
});
