import { appKeyPrefix } from "../../runtime/appKeyPrefix";
import type { OAuthProfile, OAuthProvider } from "./types";

class SamlProvider implements OAuthProvider {
  readonly name = "saml";

  constructor(private readonly loginUrl: string) {}

  getAuthorizationUrl(state: string): string {
    return `${this.loginUrl}?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<OAuthProfile> {
    if (!code.startsWith("saml:")) {
      throw new Error("Invalid SAML assertion reference.");
    }

    const [, email, name] = code.split(":");

    return {
      providerUserId: email || "saml-user",
      email: email || `saml-user@${appKeyPrefix()}.test`,
      name: name ?? "SAML User",
    };
  }
}

export { SamlProvider };
