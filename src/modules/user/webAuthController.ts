import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { clearSessionCookie, createSessionCookie } from "@getstrata/core/auth/sessionCookie";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { withErrorHandling } from "@getstrata/core/http/response";
import { sanitizeInternalPath } from "@getstrata/core/http/safeInternalPath";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import type AuthService from "./authService";
import type PasswordResetService from "./passwordResetService";
import { authServiceToken, passwordResetServiceToken, userRepositoryToken } from "./provider";
import type UserRepository from "./repository";
import {
  parseWebForgotPasswordBody,
  parseWebLoginBody,
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
        return htmlResponse(
          await this.view.render("auth/login", {
            title: "Sign in",
            redirect: body.redirect ?? "/organizations",
            errors: { email: [error.message] },
            old: { email: body.email },
          }),
          { status: 422 },
        );
      }

      throw error;
    }
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

export default WebAuthController;
