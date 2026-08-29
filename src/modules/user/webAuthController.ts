import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { clearSessionCookie, createSessionCookie } from "@getstrata/core/auth/sessionCookie";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { withErrorHandling } from "@getstrata/core/http/response";
import { sanitizeInternalPath } from "@getstrata/core/http/safeInternalPath";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { isFeatureEnabled } from "../../config/features";
import type AuthService from "./authService";
import type PasswordResetService from "./passwordResetService";
import { authServiceToken, passwordResetServiceToken, userRepositoryToken } from "./provider";
import type UserRepository from "./repository";
import {
  parseWebForgotPasswordBody,
  parseWebLoginBody,
  parseWebRegisterBody,
  parseWebResetPasswordBody,
} from "./webRequests";

class WebAuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get authService(): AuthService {
    return resolveService(this.dependencies, authServiceToken);
  }

  private get passwordResets(): PasswordResetService {
    return resolveService(this.dependencies, passwordResetServiceToken);
  }

  private get users(): UserRepository {
    return resolveService(this.dependencies, userRepositoryToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async renderLogin(extras: Record<string, unknown> = {}, status = 200): Promise<Response> {
    return htmlResponse(
      await this.view.render("auth/login", {
        title: "Sign in",
        redirect: "/organizations",
        errors: {},
        old: {},
        providers: this.authService.listOAuthProviders(),
        registrationEnabled: isFeatureEnabled("registration"),
        ...extras,
      }),
      { status },
    );
  }

  private async renderRegister(
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    return htmlResponse(
      await this.view.render("auth/register", {
        title: "Create account",
        errors: {},
        old: {},
        ...extras,
      }),
      { status },
    );
  }

  readonly showLogin = withErrorHandling(async (request?: Request) => {
    const redirect = new URL(request?.url ?? "http://localhost/login").searchParams.get("redirect");

    return await this.renderLogin({
      redirect: redirect ?? "/organizations",
    });
  });

  readonly showRegister = withErrorHandling(async () => {
    return await this.renderRegister();
  });

  readonly registerThrottled = withErrorHandling(async () => {
    return await this.renderRegister(
      { errors: { email: ["Too many registration attempts. Try again shortly."] } },
      429,
    );
  });

  readonly register = withErrorHandling(async (request: Request) => {
    const body = await parseWebRegisterBody(request);

    try {
      const user = await this.authService.registerWithPassword(
        body.name,
        body.email,
        body.password,
      );

      if (isFeatureEnabled("emailVerification")) {
        await this.passwordResets.sendEmailVerification(user);

        return flashResponse(Response.redirect("/login", 302), {
          level: "success",
          message: "Account created. Check your email to verify before signing in.",
        });
      }

      return new Response(null, {
        status: 302,
        headers: {
          Location: "/organizations",
          "Set-Cookie": createSessionCookie(user.id),
        },
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return await this.renderRegister(
          {
            errors: error.details ?? { email: [error.message] },
            old: { name: body.name, email: body.email },
          },
          422,
        );
      }

      throw error;
    }
  });

  readonly login = withErrorHandling(async (request: Request) => {
    const body = await parseWebLoginBody(request);

    try {
      const user = await this.authService.authenticatePassword(body.email, body.password, {
        mfaCode: body.mfaCode,
      });
      const redirect = sanitizeInternalPath(body.redirect ?? "/organizations", "/organizations");

      return new Response(null, {
        status: 302,
        headers: {
          Location: redirect,
          "Set-Cookie": createSessionCookie(user.id),
        },
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return await this.renderLogin(
          {
            redirect: body.redirect ?? "/organizations",
            errors: { email: [error.message] },
            old: { email: body.email },
          },
          422,
        );
      }

      throw error;
    }
  });

  readonly oauthRedirect = withErrorHandling(
    async (request: Request & { params: { provider: string } }) => {
      const provider = request.params.provider;
      const url = new URL(request.url);
      const redirect = sanitizeInternalPath(
        url.searchParams.get("redirect") ?? "/organizations",
        "/organizations",
      );

      try {
        const { state, cookie } = createOAuthStateCookie();
        const callbackUri = `${url.origin}/oauth/${provider}/callback`;
        const location = this.authService.buildOAuthAuthorizationUrl(provider, state, callbackUri);
        const headers = new Headers({ Location: location });
        headers.append("Set-Cookie", cookie);
        headers.append(
          "Set-Cookie",
          `oauth_login_redirect=${encodeURIComponent(redirect)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
        );

        return new Response(null, { status: 302, headers });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          return await this.renderLogin({ redirect, errors: { oauth: [error.message] } }, 422);
        }

        throw error;
      }
    },
  );

  readonly oauthCallback = withErrorHandling(
    async (request: Request & { params: { provider: string } }) => {
      const provider = request.params.provider;
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const redirect = sanitizeInternalPath(
        readOAuthLoginRedirect(request) ?? "/organizations",
        "/organizations",
      );

      try {
        if (!provider || !code) {
          throw new UnauthorizedError("OAuth provider and code are required.");
        }

        if (!verifyOAuthState(request, state)) {
          throw new UnauthorizedError("Invalid OAuth state.");
        }

        const user = await this.authService.authenticateOAuth(provider, code, {
          redirectUri: `${url.origin}/oauth/${provider}/callback`,
        });
        const headers = new Headers({ Location: redirect });
        headers.append("Set-Cookie", createSessionCookie(user.id));
        headers.append("Set-Cookie", clearOAuthStateCookie());
        headers.append("Set-Cookie", clearOAuthLoginRedirectCookie());

        return new Response(null, { status: 302, headers });
      } catch (error) {
        const message = error instanceof Error ? error.message : "OAuth login failed.";

        return await this.renderLogin({ redirect, errors: { oauth: [message] } }, 422);
      }
    },
  );

  readonly logout = withErrorHandling(async () => {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/login",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  });

  readonly showForgotPassword = withErrorHandling(async () => {
    return htmlResponse(
      await this.view.render("auth/forgot-password", {
        title: "Forgot password",
        errors: {},
        old: {},
        sent: false,
      }),
    );
  });

  readonly sendResetLink = withErrorHandling(async (request: Request) => {
    const body = await parseWebForgotPasswordBody(request);
    await this.passwordResets.requestReset(body.email);

    return htmlResponse(
      await this.view.render("auth/forgot-password", {
        title: "Forgot password",
        errors: {},
        old: { email: body.email },
        sent: true,
      }),
    );
  });

  readonly showResetPassword = withErrorHandling(async (request: Request) => {
    const url = new URL(request.url);

    return htmlResponse(
      await this.view.render("auth/reset-password", {
        title: "Reset password",
        email: url.searchParams.get("email") ?? "",
        token: url.searchParams.get("token") ?? "",
        expires: url.searchParams.get("expires") ?? "",
        signature: url.searchParams.get("signature") ?? "",
        errors: {},
      }),
    );
  });

  readonly resetPassword = withErrorHandling(async (request: Request) => {
    const body = await parseWebResetPasswordBody(request);
    await this.passwordResets.resetPassword(body.email, body.token, body.password);

    return flashResponse(Response.redirect("/login", 302), {
      level: "success",
      message: "Password updated. Sign in with your new password.",
    });
  });

  readonly verifyEmail = withErrorHandling(async (request: Request) => {
    const userId = Number.parseInt(new URL(request.url).searchParams.get("id") ?? "", 10);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedError("Invalid verification link.");
    }

    await this.authService.markEmailVerified(userId);

    return flashResponse(Response.redirect("/login", 302), {
      level: "success",
      message: "Email address verified. You can sign in now.",
    });
  });

  readonly resendVerification = withErrorHandling(async (request: Request) => {
    const body = await parseWebForgotPasswordBody(request);
    const user = await this.users.findByEmail(body.email);

    if (user && !user.email_verified_at) {
      await this.passwordResets.sendEmailVerification(user);
    }

    return flashResponse(Response.redirect("/login", 302), {
      level: "success",
      message: "If that account needs verification, a new link is on its way.",
    });
  });
}

const OAUTH_LOGIN_REDIRECT_COOKIE = "oauth_login_redirect";

function readOAuthLoginRedirect(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === OAUTH_LOGIN_REDIRECT_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function clearOAuthLoginRedirectCookie(): string {
  return `${OAUTH_LOGIN_REDIRECT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export default WebAuthController;
