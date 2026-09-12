import { createHash, randomBytes } from "node:crypto";
import { isProductionEnv } from "../../runtime/appEnv";
import { safeFetch } from "../../security/safeFetch";
import {
  loadOidcDiscovery,
  resetOidcDiscoveryCacheForTests,
  verifyOidcIdToken,
} from "./oidcIdToken";
import type { OAuthProfile, OAuthProvider } from "./types";

interface OidcProviderOptions {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

interface OidcHandshake {
  state: string;
  nonce: string;
  codeVerifier: string;
}

interface OidcTokenResponse {
  access_token?: string;
  id_token?: string;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function createOidcHandshake(): OidcHandshake {
  return {
    state: randomBytes(24).toString("hex"),
    nonce: randomBytes(24).toString("hex"),
    codeVerifier: base64Url(randomBytes(32)),
  };
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

class OidcProvider implements OAuthProvider {
  readonly name: string;

  constructor(private readonly options: OidcProviderOptions) {
    this.name = options.name;
  }

  getAuthorizationUrl(_state: string, _redirectUri = this.options.redirectUri): string {
    throw new Error(
      "OidcProvider.getAuthorizationUrl cannot complete PKCE. Use createAuthorization() and pass the handshake to exchangeCode().",
    );
  }

  createAuthorization(
    state = createOidcHandshake().state,
    redirectUri = this.options.redirectUri,
  ): { url: string; handshake: OidcHandshake } {
    const handshake = { ...createOidcHandshake(), state };
    return {
      url: this.buildAuthorizationUrl(state, handshake, redirectUri),
      handshake,
    };
  }

  private buildAuthorizationUrl(
    state: string,
    handshake: OidcHandshake,
    redirectUri: string,
  ): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: (this.options.scopes ?? ["openid", "email", "profile"]).join(" "),
      state,
      nonce: handshake.nonce,
      code_challenge: codeChallenge(handshake.codeVerifier),
      code_challenge_method: "S256",
    });

    return `${this.options.issuer.replace(/\/$/, "")}/authorize?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri = this.options.redirectUri,
    handshake?: Pick<OidcHandshake, "nonce" | "codeVerifier">,
  ): Promise<OAuthProfile> {
    if (!handshake?.nonce?.trim() || !handshake.codeVerifier?.trim()) {
      throw new Error(
        "OIDC token exchange requires the PKCE handshake from createAuthorization().",
      );
    }

    const discovery = await loadOidcDiscovery(this.options.issuer);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      code_verifier: handshake.codeVerifier,
    });

    const tokenResponse = await safeFetch(
      discovery.token_endpoint ?? `${this.options.issuer.replace(/\/$/, "")}/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      { allowHttp: !isProductionEnv(), timeoutMs: 10_000, maxRedirects: 0 },
    );

    const tokenBody = (await tokenResponse.json()) as OidcTokenResponse;

    if (!tokenBody.access_token) {
      throw new Error("OIDC token exchange failed.");
    }

    if (!tokenBody.id_token) {
      throw new Error("OIDC token exchange did not return an ID token.");
    }

    const payload = await verifyOidcIdToken(tokenBody.id_token, {
      issuer: this.options.issuer,
      clientId: this.options.clientId,
      nonce: handshake.nonce,
      jwksUri: discovery.jwks_uri ?? "",
    });

    if (typeof payload.email !== "string" || !payload.email.trim()) {
      throw new Error("OIDC ID token did not include an email address.");
    }

    return {
      providerUserId: String(payload.sub),
      email: payload.email,
      name: typeof payload.name === "string" && payload.name ? payload.name : String(payload.sub),
    };
  }
}

export type { OidcHandshake, OidcProviderOptions };
export { createOidcHandshake, OidcProvider, resetOidcDiscoveryCacheForTests };
