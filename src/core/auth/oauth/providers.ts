import { appUserAgent } from "../../runtime/appKeyPrefix";
import type { OAuthProfile, OAuthProvider } from "./types";

interface GitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

class GitHubOAuthProvider implements OAuthProvider {
  readonly name = "github";

  constructor(private readonly options: GitHubOAuthOptions) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: "read:user user:email",
      state,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthProfile> {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: this.options.redirectUri,
      }),
    });

    const tokenBody = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenBody.access_token) {
      throw new Error("GitHub OAuth token exchange failed.");
    }

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/json",
        "user-agent": appUserAgent(),
      },
    });

    const profile = (await profileResponse.json()) as {
      id: number;
      login: string;
      email?: string | null;
      name?: string | null;
    };

    return {
      providerUserId: String(profile.id),
      email: profile.email ?? `${profile.login}@users.noreply.github.com`,
      name: profile.name ?? profile.login,
    };
  }
}

class MockOAuthProvider implements OAuthProvider {
  readonly name = "mock";

  constructor(private readonly profile: OAuthProfile) {}

  getAuthorizationUrl(state: string): string {
    return `https://mock.oauth/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<OAuthProfile> {
    if (code !== "valid-code") {
      throw new Error("Invalid OAuth code.");
    }

    return this.profile;
  }
}

export type { GitHubOAuthOptions };
export { GitHubOAuthProvider, MockOAuthProvider };
