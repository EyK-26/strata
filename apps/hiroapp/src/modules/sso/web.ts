import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";
import { redirectWithCookies, sessionMetaFromRequest, withCookies } from "../../http/cookies.ts";
import { authManager } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebGuest } from "../../http/wrap.ts";
import { toSessionUser } from "../../lib/sessionUser.ts";
import { resolveSsoProvider, ssoProviderNames, ssoService } from "./service.ts";

function providerFromPath(pathname: string): string {
  return pathname.split("/").filter(Boolean)[2] ?? "";
}

export function ssoWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/login/sso": {
      GET: wrapWebGuest(dependencies, async (request) =>
        renderPage(request, "auth/sso", { providers: ssoProviderNames(), errors: {} }, 200, false),
      ),
    },
    "/auth/oauth/:provider": {
      GET: wrapWebGuest(dependencies, async (request) => {
        const providerName = providerFromPath(new URL(request.url).pathname);
        const provider = resolveSsoProvider(providerName);
        if (!provider) {
          return renderPage(
            request,
            "auth/sso",
            {
              providers: ssoProviderNames(),
              errors: { provider: "That sign-in option is not configured." },
            },
            404,
            false,
          );
        }
        const { state, cookie } = createOAuthStateCookie();
        return redirectWithCookies(provider.getAuthorizationUrl(state), [cookie]);
      }),
    },
    "/auth/oauth/:provider/callback": {
      GET: wrapWebGuest(dependencies, async (request) => {
        const url = new URL(request.url);
        const providerName = providerFromPath(url.pathname);
        const provider = resolveSsoProvider(providerName);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!provider || !code || !verifyOAuthState(request, state)) {
          return withCookies(
            renderPage(
              request,
              "auth/sso",
              {
                providers: ssoProviderNames(),
                errors: { provider: "Sign-in was cancelled or expired." },
              },
              401,
              false,
            ),
            [clearOAuthStateCookie()],
          );
        }
        const profile = await provider.exchangeCode(code);
        const user = await ssoService.loginFromProfile(providerName, profile);
        const signedIn = await authManager().signIn(
          toSessionUser(user),
          sessionMetaFromRequest(request),
        );
        return redirectWithCookies("/", [signedIn.setCookie, clearOAuthStateCookie()]);
      }),
    },
  };
}
