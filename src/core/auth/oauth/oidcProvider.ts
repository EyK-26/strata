import type { OAuthProfile, OAuthProvider } from "./types";

interface OidcProviderOptions {
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

class OidcProvider implements OAuthProvider {
  readonly name: string;

  constructor(private readonly options: OidcProviderOptions) {
    this.name = options.name;
  }

  getAuthorizationUrl(state: string, redirectUri = this.options.redirectUri): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: (this.options.scopes ?? ["openid", "email", "profile"]).join(" "),
      state,
    });

    return `${this.options.issuer.replace(/\/$/, "")}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri = this.options.redirectUri): Promise<OAuthProfile> {
    const tokenResponse = await fetch(`${this.options.issuer.replace(/\/$/, "")}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
    });

    const tokenBody = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenBody.access_token) {
      throw new Error("OIDC token exchange failed.");
    }

    const profileResponse = await fetch(`${this.options.issuer.replace(/\/$/, "")}/userinfo`, {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });

    const profile = (await profileResponse.json()) as {
      sub: string;
      email?: string;
      name?: string;
    };

    return {
      providerUserId: profile.sub,
      email: profile.email ?? `${profile.sub}@oidc.local`,
      name: profile.name ?? profile.sub,
    };
  }
}

export type { OidcProviderOptions };
export { OidcProvider };
