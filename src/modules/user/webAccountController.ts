import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import { clearSessionCookie } from "@getstrata/core/auth/sessionCookie";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { flashResponse } from "@getstrata/core/http/flashSession";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import { appKeyPrefix } from "@getstrata/core/runtime/appKeyPrefix";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { isFeatureEnabled } from "../../config/features";
import type AuthService from "./authService";
import type OAuthIdentityRepository from "./oauthIdentityRepository";
import type PasswordResetService from "./passwordResetService";
import {
  authServiceToken,
  oauthIdentityRepositoryToken,
  passwordResetServiceToken,
  tokenServiceToken,
  userRepositoryToken,
} from "./provider";
import type UserRepository from "./repository";
import { parseTokenIdParams } from "./requests";
import { toUserResource } from "./resources";
import type TokenService from "./tokenService";
import type { ApiTokenResource, UserRecord } from "./types";
import {
  parseWebChangePasswordBody,
  parseWebConfirmMfaBody,
  parseWebCreateApiTokenBody,
  parseWebDeleteAccountBody,
  parseWebDisableMfaBody,
} from "./webRequests";

class WebAccountController {
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

  private get tokens(): TokenService {
    return resolveService(this.dependencies, tokenServiceToken);
  }

  private get oauthIdentities(): OAuthIdentityRepository {
    return resolveService(this.dependencies, oauthIdentityRepositoryToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private requireUserId(): number {
    const user = currentAuthUser();
    const userId = typeof user?.id === "number" ? user.id : Number(user?.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedError("Authentication required.");
    }

    return userId;
  }

  private async renderAccount(
    user: UserRecord,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const tokens = Array.isArray(extras.tokens)
      ? (extras.tokens as ApiTokenResource[])
      : await this.tokens.listTokensForUser(user.id);

    return htmlResponse(
      await this.view.render("account/show", {
        title: "Account",
        user,
        tokens,
        plainToken: null,
        mfaEnabled: Boolean(user.mfa_enabled),
        mfaFeatureEnabled: isFeatureEnabled("mfa"),
        pendingSecret: null,
        otpauthUrl: null,
        errors: {},
        ...extras,
      }),
      { status },
    );
  }

  readonly show = withErrorHandling(async () => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    return await this.renderAccount(user);
  });

  readonly beginMfa = withErrorHandling(async () => {
    const userId = this.requireUserId();
    const setup = await this.authService.beginMfaSetup(userId);
    const user = await this.users.findByIdOrThrow(userId);

    return await this.renderAccount(user, {
      pendingSecret: setup.secret,
      otpauthUrl: setup.otpauthUrl,
    });
  });

  readonly confirmMfa = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebConfirmMfaBody(request);
      await this.authService.confirmMfaSetup(userId, body.mfaCode);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Two-factor authentication is on.",
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      throw error;
    }
  });

  readonly disableMfa = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebDisableMfaBody(request);
      await this.authService.disableMfa(userId, body.password);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Two-factor authentication is off.",
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: { password: [error.message] } }, 422);
      }

      throw error;
    }
  });

  readonly changePassword = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebChangePasswordBody(request);
      await this.authService.changePassword(userId, body.currentPassword, body.password);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Password updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      if (error instanceof UnauthorizedError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(
          user,
          { errors: { current_password: [error.message] } },
          422,
        );
      }

      throw error;
    }
  });

  readonly resendVerification = withErrorHandling(async () => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    if (!user.email_verified_at) {
      await this.passwordResets.sendEmailVerification(user);
    }

    return flashResponse(Response.redirect("/account", 302), {
      level: "success",
      message: "If this address still needs verification, a new link is on its way.",
    });
  });

  readonly storeToken = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebCreateApiTokenBody(request);
      const created = await this.tokens.createToken(userId, {
        name: body.name,
        expiresInDays: body.expiresInDays,
      });
      const user = await this.users.findByIdOrThrow(userId);

      return await this.renderAccount(user, { plainToken: created.plainTextToken });
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      throw error;
    }
  });

  readonly revokeToken = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();
    const params = (request as Request & { params?: { id: string } }).params;

    if (!params?.id) {
      throw new ValidationError("Token id is required.");
    }

    const { id } = parseTokenIdParams(params);
    await this.tokens.revokeToken(userId, id);

    return flashResponse(Response.redirect("/account", 302), {
      level: "success",
      message: "API token revoked.",
    });
  });

  readonly exportAccount = withErrorHandling(async () => {
    const userId = this.requireUserId();
    const user = await this.users.findByIdOrThrow(userId);
    const [tokens, identities] = await Promise.all([
      this.tokens.listTokensForUser(userId),
      this.oauthIdentities.findAll({ where: { user_id: userId } }),
    ]);

    return new Response(
      JSON.stringify({
        user: toUserResource(user),
        api_tokens: tokens.map((token) => ({
          id: token.id,
          name: token.name,
          abilities: token.abilities,
          created_at: token.created_at,
        })),
        oauth_identities: identities.map((identity) => ({
          provider: identity.provider,
          email: identity.email,
          created_at: identity.created_at.toISOString(),
        })),
        exported_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${appKeyPrefix()}-export.json"`,
        },
      },
    );
  });

  readonly deleteAccount = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebDeleteAccountBody(request);
      const user = await this.users.findByIdOrThrow(userId);

      if (!user.password_hash || !(await verifyPassword(body.password, user.password_hash))) {
        throw new UnauthorizedError("Invalid credentials.");
      }

      await this.tokens.deleteUserAccount(userId);

      return flashResponse(
        new Response(null, {
          status: 302,
          headers: {
            Location: "/login",
            "Set-Cookie": clearSessionCookie(),
          },
        }),
        {
          level: "success",
          message: "Your account has been deleted.",
        },
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      if (error instanceof UnauthorizedError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: { password: [error.message] } }, 422);
      }

      throw error;
    }
  });
}

function createWebAccountRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new WebAccountController(dependencies);

  return {
    "/account": {
      GET: kernel.wrapWebAuthenticated(controller.show as unknown as RouteHandler),
    },
    "/account/mfa": {
      POST: kernel.wrapWebAuthenticated(controller.beginMfa as unknown as RouteHandler),
    },
    "/account/mfa/confirm": {
      POST: kernel.wrapWebAuthenticated(controller.confirmMfa as unknown as RouteHandler),
    },
    "/account/mfa/disable": {
      POST: kernel.wrapWebAuthenticated(controller.disableMfa as unknown as RouteHandler),
    },
    "/account/password": {
      POST: kernel.wrapWebAuthenticated(controller.changePassword as unknown as RouteHandler),
    },
    "/account/email/verification-notification": {
      POST: kernel.wrapWebAuthenticatedAllowUnverified(
        controller.resendVerification as unknown as RouteHandler,
      ),
    },
    "/account/tokens": {
      POST: kernel.wrapWebAuthenticated(controller.storeToken as unknown as RouteHandler),
    },
    "/account/tokens/:id/revoke": {
      POST: kernel.wrapWebAuthenticated(controller.revokeToken as unknown as RouteHandler),
    },
    "/account/export": {
      GET: kernel.wrapWebAuthenticated(controller.exportAccount as unknown as RouteHandler),
    },
    "/account/delete": {
      POST: kernel.wrapWebAuthenticated(controller.deleteAccount as unknown as RouteHandler),
    },
  };
}

export default WebAccountController;
export { createWebAccountRoutes };
