import type { ServiceProvider } from "../../bootstrap/contracts";
import { GitHubOAuthProvider, MockOAuthProvider } from "../../core/auth/oauth/providers";
import { OidcProvider } from "../../core/auth/oauth/oidcProvider";
import { SamlProvider } from "../../core/auth/oauth/samlProvider";
import { isFeatureEnabled } from "../../config/features";
import ApiTokenRepository from "./apiTokenRepository";
import AuthService from "./authService";
import OAuthIdentityRepository from "./oauthIdentityRepository";
import UserRepository from "./repository";
import TokenService from "./tokenService";

const userRepositoryToken = "user.repository";
const apiTokenRepositoryToken = "user.apiTokenRepository";
const tokenServiceToken = "user.tokenService";
const authServiceToken = "user.authService";
const oauthIdentityRepositoryToken = "user.oauthIdentityRepository";

const userProvider: ServiceProvider = {
  name: "user.provider",
  register({ container }) {
    container.singleton(userRepositoryToken, () => new UserRepository());
    container.singleton(apiTokenRepositoryToken, () => new ApiTokenRepository());
    container.singleton(oauthIdentityRepositoryToken, () => new OAuthIdentityRepository());
  },
  boot({ container }) {
    container.singleton(tokenServiceToken, () => {
      const users = container.resolve<UserRepository>(userRepositoryToken);
      const tokens = container.resolve<ApiTokenRepository>(apiTokenRepositoryToken);
      return new TokenService(users, tokens);
    });

    container.singleton(authServiceToken, () => {
      const authService = new AuthService(
        container.resolve<UserRepository>(userRepositoryToken),
        container.resolve<TokenService>(tokenServiceToken),
        container.resolve<OAuthIdentityRepository>(oauthIdentityRepositoryToken),
      );

      const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
      const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
      const oauthRedirectUri = process.env.OAUTH_REDIRECT_URI?.trim();

      if (githubClientId && githubClientSecret && oauthRedirectUri) {
        authService.registerOAuthProvider(
          new GitHubOAuthProvider({
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            redirectUri: oauthRedirectUri,
          }),
        );
      }

      const oidcIssuer = process.env.OIDC_ISSUER?.trim();
      const oidcClientId = process.env.OIDC_CLIENT_ID?.trim();
      const oidcClientSecret = process.env.OIDC_CLIENT_SECRET?.trim();

      if (isFeatureEnabled("oauthLogin") && oidcIssuer && oidcClientId && oidcClientSecret && oauthRedirectUri) {
        authService.registerOAuthProvider(
          new OidcProvider({
            name: "oidc",
            issuer: oidcIssuer,
            clientId: oidcClientId,
            clientSecret: oidcClientSecret,
            redirectUri: oauthRedirectUri,
          }),
        );
      }

      if (isFeatureEnabled("samlLogin") && process.env.SAML_LOGIN_URL?.trim()) {
        authService.registerOAuthProvider(new SamlProvider(process.env.SAML_LOGIN_URL.trim()));
      }

      if ((process.env.APP_ENV ?? "local") !== "production") {
        authService.registerOAuthProvider(
          new MockOAuthProvider({
            providerUserId: "mock-user-1",
            email: "oauth@workhub.test",
            name: "OAuth User",
          }),
        );
      }

      return authService;
    });
  },
};

export default userProvider;
export {
  apiTokenRepositoryToken,
  authServiceToken,
  oauthIdentityRepositoryToken,
  tokenServiceToken,
  userRepositoryToken,
};
