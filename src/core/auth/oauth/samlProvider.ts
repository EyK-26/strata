import {
  createSamlServiceProvider,
  type SamlServiceProviderOptions,
} from "../saml/samlServiceProvider";
import type { OAuthProfile, OAuthProvider } from "./types";

class SamlProvider implements OAuthProvider {
  readonly name = "saml";
  private readonly provider;

  constructor(options: SamlServiceProviderOptions | string) {
    if (typeof options === "string") {
      throw new Error(
        "SamlProvider now requires IdP metadata (idpSsoUrl, idpCert, spEntityId, acsUrl, idpIssuer). The string constructor login stub has been removed.",
      );
    }

    this.provider = createSamlServiceProvider(options);
  }

  getAuthorizationUrl(_state: string): string {
    throw new Error("SAML authorization is async. Use SamlServiceProvider.authorizationUrl().");
  }

  async exchangeCode(_code: string): Promise<OAuthProfile> {
    throw new Error("SAML login uses consumePost() with a signed SAMLResponse, not an OAuth code.");
  }

  authorizationUrl(relayState: string): Promise<string> {
    return this.provider.authorizationUrl(relayState);
  }

  consumePost(samlResponse: string, relayState?: string): Promise<OAuthProfile> {
    return this.provider.consumePost(samlResponse, relayState);
  }
}

export { SamlProvider };
