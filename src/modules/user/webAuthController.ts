import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import {
  clearIntendedUrlCookie,
  createIntendedUrlCookie,
  readIntendedUrl,
} from "@getstrata/core/auth/intendedUrlCookie";
import { verifyPassword } from "@getstrata/core/auth/password";
import {
  clearPasswordConfirmCookie,
  createPasswordConfirmCookie,
} from "@getstrata/core/auth/passwordConfirmCookie";
import { clearSessionCookie, readSession } from "@getstrata/core/auth/sessionCookie";
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
import { organizationServiceToken } from "../organization/provider";
import type OrganizationService from "../organization/service";
import type AuthService from "./authService";
import { forgetHmacBrowserSession, issueHmacBrowserSession } from "./browserSessions";
import {
  type CurrentOrganizationService,
  currentOrganizationServiceToken,
} from "./currentOrganizationService";
import {
  clearMfaChallengeCookie,
  createMfaChallengeCookie,
  readMfaChallenge,
} from "./mfaChallengeCookie";
import { MfaRequiredError } from "./mfaRequiredError";
import type PasswordResetService from "./passwordResetService";
import { authServiceToken, passwordResetServiceToken, userRepositoryToken } from "./provider";
import type UserRepository from "./repository";
import {
  parseWebConfirmPasswordBody,
  parseWebForgotPasswordBody,
  parseWebLoginBody,
  parseWebRegisterBody,
  parseWebResetPasswordBody,
  parseWebTwoFactorChallengeBody,
} from "./webRequests";

class WebAuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get authService(): AuthService {
    return resolveService(this.dependencies, authServiceToken);
  }

  private get passwordResets(): PasswordResetService {
    return resolveService(this.dependencies, passwordResetServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private get organizations(): OrganizationService {
    return resolveService(this.dependencies, organizationServiceToken);
  }

  private get users(): UserRepository {
    return resolveService(this.dependencies, userRepositoryToken);
  }

  private get currentOrganization(): CurrentOrganizationService {
    return resolveService(this.dependencies, currentOrganizationServiceToken);
  }

  private requireUserId(): number {
    const user = currentAuthUser();
    const userId = typeof user?.id === "number" ? user.id : Number(user?.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedError("Authentication required.");
    }

    return userId;
  }

  private async renderConfirmPassword(
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    return htmlResponse(
      await this.view.render("auth/confirm-password", {
        title: "Confirm password",
        redirect: "/account",
        errors: {},
        ...extras,
      }),
      { status },
    );
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

  readonly showRegister = withErrorHandling(async (request?: Request) => {
    const redirect = new URL(request?.url ?? "http://localhost/register").searchParams.get(
      "redirect",
    );

    return await this.renderRegister({
      redirect: redirect ?? "",
    });
  });

  readonly registerThrottled = withErrorHandling(async () => {
    return await this.renderRegister(
      { errors: { email: ["Too many registration attempts. Try again shortly."] } },
      429,
    );
  });

  readonly loginThrottled = withErrorHandling(async () => {
    return await this.renderLogin(
      { errors: { email: ["Too many login attempts. Try again shortly."] } },
      429,
    );
  });

  readonly forgotPasswordThrottled = withErrorHandling(async () => {
    return htmlResponse(
      await this.view.render("auth/forgot-password", {
        title: "Forgot password",
        errors: { email: ["Too many reset attempts. Try again shortly."] },
        old: {},
        sent: false,
      }),
      { status: 429 },
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
      await this.organizations.createPersonalForUser(user);

      if (isFeatureEnabled("emailVerification")) {
        await this.passwordResets.sendEmailVerification(user);
        const headers = new Headers({ Location: "/email/verify" });
        headers.append("Set-Cookie", (await issueHmacBrowserSession(request, user.id)).header);
        const intended = createIntendedUrlCookie(body.redirect ?? "");

        if (intended) {
          headers.append("Set-Cookie", intended);
        }

        return flashResponse(new Response(null, { status: 302, headers }), {
          level: "success",
          message: "Account created. Check your email to verify the address.",
        });
      }

      const home = await this.currentOrganization.resolveHomePath(user.id);
      const location = body.redirect ? sanitizeInternalPath(body.redirect, home) : home;
      const session = await issueHmacBrowserSession(request, user.id);

      return new Response(null, {
        status: 302,
        headers: {
          Location: location,
          "Set-Cookie": session.header,
        },
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return await this.renderRegister(
          {
            errors: error.details ?? { email: [error.message] },
            old: { name: body.name, email: body.email },
            redirect: body.redirect ?? "",
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
      const redirect = await this.currentOrganization.resolveHomePath(
        user.id,
        sanitizeInternalPath(body.redirect ?? "/organizations", "/organizations"),
      );
      const session = await issueHmacBrowserSession(request, user.id, {
        remember: Boolean(body.remember),
      });

      return new Response(null, {
        status: 302,
        headers: {
          Location: redirect,
          "Set-Cookie": session.header,
        },
      });
    } catch (error) {
      if (error instanceof MfaRequiredError) {
        const redirect = sanitizeInternalPath(body.redirect ?? "/organizations", "/organizations");
        const headers = new Headers({
          Location: `/two-factor-challenge?redirect=${encodeURIComponent(redirect)}`,
        });
        headers.append(
          "Set-Cookie",
          createMfaChallengeCookie(error.userId, { remember: Boolean(body.remember) }),
        );

        return new Response(null, { status: 302, headers });
      }

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
        await this.organizations.createPersonalForUser(user);
        const location = await this.currentOrganization.resolveHomePath(user.id, redirect);
        const headers = new Headers({ Location: location });
        headers.append("Set-Cookie", (await issueHmacBrowserSession(request, user.id)).header);
        headers.append("Set-Cookie", clearOAuthStateCookie());
        headers.append("Set-Cookie", clearOAuthLoginRedirectCookie());

        return new Response(null, { status: 302, headers });
      } catch (error) {
        const message = error instanceof Error ? error.message : "OAuth login failed.";

        return await this.renderLogin({ redirect, errors: { oauth: [message] } }, 422);
      }
    },
  );

  readonly logout = withErrorHandling(async (request?: Request) => {
    if (request) {
      const session = readSession(request);

      if (session) {
        await forgetHmacBrowserSession(session.userId, session.issuedAt);
      }
    }

    const headers = new Headers({ Location: "/login" });
    headers.append("Set-Cookie", clearSessionCookie());
    headers.append("Set-Cookie", clearPasswordConfirmCookie());
    headers.append("Set-Cookie", clearMfaChallengeCookie());
    headers.append("Set-Cookie", clearIntendedUrlCookie());

    return new Response(null, { status: 302, headers });
  });

  readonly showTwoFactorChallenge = withErrorHandling(async (request?: Request) => {
    const current = request ? readMfaChallenge(request) : null;

    if (!current) {
      return Response.redirect("/login", 302);
    }

    const redirect = new URL(
      request?.url ?? "http://localhost/two-factor-challenge",
    ).searchParams.get("redirect");

    return htmlResponse(
      await this.view.render("auth/two-factor-challenge", {
        title: "Two-factor challenge",
        redirect: sanitizeInternalPath(redirect ?? "/organizations", "/organizations"),
        errors: {},
      }),
    );
  });

  readonly twoFactorChallenge = withErrorHandling(async (request: Request) => {
    const pending = readMfaChallenge(request);

    if (!pending) {
      return Response.redirect("/login", 302);
    }

    const body = await parseWebTwoFactorChallengeBody(request);
    const redirect = sanitizeInternalPath(body.redirect ?? "/organizations", "/organizations");

    try {
      const user = await this.authService.verifyMfaChallenge(pending.userId, body.mfaCode);
      const location = await this.currentOrganization.resolveHomePath(user.id, redirect);
      const headers = new Headers({ Location: location });
      headers.append(
        "Set-Cookie",
        (await issueHmacBrowserSession(request, user.id, { remember: pending.remember })).header,
      );
      headers.append("Set-Cookie", clearMfaChallengeCookie());

      return new Response(null, { status: 302, headers });
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ValidationError) {
        return htmlResponse(
          await this.view.render("auth/two-factor-challenge", {
            title: "Two-factor challenge",
            redirect,
            errors: { mfa_code: [error.message] },
          }),
          { status: 422 },
        );
      }

      throw error;
    }
  });

  readonly showConfirmPassword = withErrorHandling(async (request?: Request) => {
    const redirect = new URL(request?.url ?? "http://localhost/confirm-password").searchParams.get(
      "redirect",
    );

    return await this.renderConfirmPassword({
      redirect: sanitizeInternalPath(redirect ?? "/account", "/account"),
    });
  });

  readonly confirmPassword = withErrorHandling(async (request: Request) => {
    const body = await parseWebConfirmPasswordBody(request);
    const redirect = sanitizeInternalPath(body.redirect ?? "/account", "/account");

    try {
      const userId = this.requireUserId();
      const user = await this.users.findByIdOrThrow(userId);

      if (!user.password_hash) {
        throw new ValidationError("This account does not have a password.", {
          password: ["This account does not have a password."],
        });
      }

      if (!(await verifyPassword(body.password, user.password_hash))) {
        throw new UnauthorizedError("The provided password was incorrect.");
      }

      const headers = new Headers({ Location: redirect });
      headers.append("Set-Cookie", createPasswordConfirmCookie(userId));

      return flashResponse(new Response(null, { status: 302, headers }), {
        level: "success",
        message: "Password confirmed.",
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return await this.renderConfirmPassword(
          {
            redirect,
            errors: error.details ?? { password: [error.message] },
          },
          422,
        );
      }

      if (error instanceof UnauthorizedError) {
        return await this.renderConfirmPassword(
          {
            redirect,
            errors: { password: [error.message] },
          },
          422,
        );
      }

      throw error;
    }
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
    const location = await this.currentOrganization.resolveHomePath(
      userId,
      readIntendedUrl(request) ?? "/organizations",
    );
    const headers = new Headers({ Location: location });
    headers.append("Set-Cookie", clearIntendedUrlCookie());

    return flashResponse(new Response(null, { status: 302, headers }), {
      level: "success",
      message: "Email address verified.",
    });
  });

  readonly showVerifyNotice = withErrorHandling(async () => {
    return htmlResponse(
      await this.view.render("auth/verify-email", {
        title: "Verify email",
        errors: {},
        old: {},
      }),
    );
  });

  readonly resendVerification = withErrorHandling(async (request: Request) => {
    const body = await parseWebForgotPasswordBody(request);
    await this.passwordResets.requestEmailVerification(body.email);

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
