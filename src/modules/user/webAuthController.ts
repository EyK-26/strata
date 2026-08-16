import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { clearSessionCookie, createSessionCookie } from "@getstrata/core/auth/sessionCookie";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { withErrorHandling } from "@getstrata/core/http/response";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import type AuthService from "./authService";
import { authServiceToken, tokenServiceToken } from "./provider";
import type TokenService from "./tokenService";
import { parseWebLoginBody } from "./webRequests";

class WebAuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get authService(): AuthService {
    return resolveService(this.dependencies, authServiceToken);
  }

  private get tokens(): TokenService {
    return resolveService(this.dependencies, tokenServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  readonly showLogin = withErrorHandling(async (request?: Request) => {
    const redirect = new URL(request?.url ?? "http://localhost/login").searchParams.get("redirect");

    return htmlResponse(
      await this.view.render("auth/login", {
        title: "Sign in",
        redirect: redirect ?? "/organizations",
        errors: {},
        old: {},
      }),
    );
  });

  readonly login = withErrorHandling(async (request: Request) => {
    const body = await parseWebLoginBody(request);
    const created = await this.authService.loginWithPassword(body.email, body.password);
    const authUser = await this.tokens.resolveUserFromToken(created.plainTextToken);
    const userId = Number(authUser?.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const redirect = body.redirect?.startsWith("/") ? body.redirect : "/organizations";

    return new Response(null, {
      status: 302,
      headers: {
        Location: redirect,
        "Set-Cookie": createSessionCookie(userId),
      },
    });
  });

  readonly logout = withErrorHandling(async () => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/login",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  });
}

export default WebAuthController;
