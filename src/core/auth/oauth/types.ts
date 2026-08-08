interface OAuthProfile {
  providerUserId: string;
  email: string;
  name: string;
}

interface OAuthProvider {
  readonly name: string;
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthProfile>;
}

export type { OAuthProfile, OAuthProvider };
