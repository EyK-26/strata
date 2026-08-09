interface OAuthProfile {
  providerUserId: string;
  email: string;
  name: string;
}

interface OAuthProvider {
  readonly name: string;
  getAuthorizationUrl(state: string, redirectUri?: string): string;
  exchangeCode(code: string, redirectUri?: string): Promise<OAuthProfile>;
}

export type { OAuthProfile, OAuthProvider };
