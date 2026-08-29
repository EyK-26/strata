import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_AUTH_USER_DIRECTORY_TOKEN,
  CORE_TOKEN_SERVICE_TOKEN,
} from "@getstrata/bootstrap/config";
import { OidcProvider } from "@getstrata/core/auth/oauth/oidcProvider";
import { GitHubOAuthProvider, MockOAuthProvider } from "@getstrata/core/auth/oauth/providers";
import { SamlProvider } from "@getstrata/core/auth/oauth/samlProvider";
import type { ServiceProvider } from "@getstrata/core/contracts/di";
import { isFeatureEnabled } from "../../config/features";
import ApiTokenRepository from "./apiTokenRepository";
import AuthService from "./authService";
import NotificationRepository from "./notificationRepository";
import NotificationService from "./notificationService";
import OAuthIdentityRepository from "./oauthIdentityRepository";
import PasswordResetService from "./passwordResetService";
import UserRepository from "./repository";
import TokenService from "./tokenService";

const userRepositoryToken = "user.repository";
const apiTokenRepositoryToken = "user.apiTokenRepository";
const tokenServiceToken = CORE_TOKEN_SERVICE_TOKEN;
const authServiceToken = "user.authService";
const oauthIdentityRepositoryToken = "user.oauthIdentityRepository";
const notificationRepositoryToken = "user.notificationRepository";
const notificationServiceToken = "user.notificationService";
const passwordResetServiceToken = "user.passwordResetService";

class HtmlMockOAuthProvider extends MockOAuthProvider {
  override getAuthorizationUrl(state: string): string {
    return `/oauth/mock/callback?code=valid-code&state=${encodeURIComponent(state)}`;
  }
}

const userProvider: ServiceProvider = {
  name: "user.provider",
  register({ container }) {
    container.singleton(userRepositoryToken, () => new UserRepository());
    container.singleton(apiTokenRepositoryToken, () => new ApiTokenRepository());
    container.singleton(oauthIdentityRepositoryToken, () => new OAuthIdentityRepository());
    container.singleton(notificationRepositoryToken, () => new NotificationRepository());
  },
  boot({ container }) {
    container.singleton(tokenServiceToken, () => {
      const users = container.resolve<UserRepository>(userRepositoryToken);
      const tokens = container.resolve<ApiTokenRepository>(apiTokenRepositoryToken);
      return new TokenService(users, tokens);
    });
    container.singleton(CORE_ABILITY_CHECKER_TOKEN, (appContainer) =>
      appContainer.resolve(tokenServiceToken),
    );
    container.singleton(CORE_AUTH_USER_DIRECTORY_TOKEN, (appContainer) =>
      appContainer.resolve(tokenServiceToken),
    );

    container.singleton(
      notificationServiceToken,
      () => new NotificationService(container.resolve(notificationRepositoryToken)),
    );
    container.singleton(
      passwordResetServiceToken,
      () => new PasswordResetService(container.resolve<UserRepository>(userRepositoryToken)),
    );

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

      if (
        isFeatureEnabled("oauthLogin") &&
        oidcIssuer &&
        oidcClientId &&
        oidcClientSecret &&
        oauthRedirectUri
      ) {
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
          new HtmlMockOAuthProvider({
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
  notificationRepositoryToken,
  notificationServiceToken,
  oauthIdentityRepositoryToken,
  passwordResetServiceToken,
  tokenServiceToken,
  userRepositoryToken,
};
