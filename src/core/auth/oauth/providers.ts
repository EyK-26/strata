import { appUserAgent } from "../../runtime/appKeyPrefix";
import { safeFetch } from "../../security/safeFetch";
import type { OAuthProfile, OAuthProvider } from "./types";

interface GitHubOAuthOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

async function githubVerifiedEmail(accessToken: string): Promise<string | null> {
  const emailsResponse = await safeFetch(
    "https://api.github.com/user/emails",
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "user-agent": appUserAgent(),
      },
    },
    { timeoutMs: 10_000, maxRedirects: 0 },
  );

  const emails = (await emailsResponse.json()) as unknown;
  if (!Array.isArray(emails)) {
    return null;
  }

  const verified = emails.filter(
    (item): item is { email: string; primary?: boolean; verified?: boolean } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { email?: unknown }).email === "string" &&
      Boolean((item as { email: string }).email.trim()) &&
      (item as { verified?: unknown }).verified === true,
  );
  const primary = verified.find((item) => item.primary);
  return (primary ?? verified[0])?.email.trim() ?? null;
}

class GitHubOAuthProvider implements OAuthProvider {
  readonly name = "github";

  constructor(private readonly options: GitHubOAuthOptions) {}

  getAuthorizationUrl(state: string, redirectUri = this.options.redirectUri): string {
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri = this.options.redirectUri): Promise<OAuthProfile> {
    const tokenResponse = await safeFetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
      { timeoutMs: 10_000, maxRedirects: 0 },
    );

    const tokenBody = (await tokenResponse.json()) as { access_token?: string };

    if (!tokenBody.access_token) {
      throw new Error("GitHub OAuth token exchange failed.");
    }

    const profileResponse = await safeFetch(
      "https://api.github.com/user",
      {
        headers: {
          authorization: `Bearer ${tokenBody.access_token}`,
          accept: "application/json",
          "user-agent": appUserAgent(),
        },
      },
      { timeoutMs: 10_000, maxRedirects: 0 },
    );

    const profile = (await profileResponse.json()) as {
      id: number;
      login: string;
      email?: string | null;
      name?: string | null;
    };

    const email = await githubVerifiedEmail(tokenBody.access_token);
    if (!email) {
      throw new Error("GitHub OAuth profile did not include a verified email address.");
    }

    return {
      providerUserId: String(profile.id),
      email,
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
