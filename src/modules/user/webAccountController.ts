import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { resolveAbilitiesForRole } from "@getstrata/core/auth/abilityCatalog";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { verifyPassword } from "@getstrata/core/auth/password";
import { clearPasswordConfirmCookie } from "@getstrata/core/auth/passwordConfirmCookie";
import { clearSessionCookie, readSession } from "@getstrata/core/auth/sessionCookie";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { flashResponse } from "@getstrata/core/http/flashSession";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { parseMultipartUpload } from "@getstrata/core/http/parseMultipartUpload";
import { withErrorHandling } from "@getstrata/core/http/response";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import { appKeyPrefix } from "@getstrata/core/runtime/appKeyPrefix";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { isFeatureEnabled } from "../../config/features";
import {
  type OrganizationInvitationService,
  organizationInvitationServiceToken,
} from "../organization/invitationService";
import type AuthService from "./authService";
import {
  forgetBrowserSessionById,
  forgetHmacBrowserSession,
  forgetOtherBrowserSessions,
  hmacBrowserSessionId,
  issueHmacBrowserSession,
  listBrowserSessionsForUser,
  parseBrowserSessionId,
} from "./browserSessions";
import type OAuthIdentityRepository from "./oauthIdentityRepository";
import type PasswordResetService from "./passwordResetService";
import type ProfilePhotoService from "./profilePhotoService";
import { profilePhotoServiceToken } from "./profilePhotoService";
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
import { grantableTokenAbilities } from "./tokenService";
import type { ApiTokenResource, UserRecord } from "./types";
import {
  parseWebChangePasswordBody,
  parseWebConfirmMfaBody,
  parseWebCreateApiTokenBody,
  parseWebDeleteAccountBody,
  parseWebDisableMfaBody,
  parseWebUpdateProfileBody,
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

  private get invitations(): OrganizationInvitationService {
    return resolveService(this.dependencies, organizationInvitationServiceToken);
  }

  private tryPhotos(): ProfilePhotoService | null {
    try {
      if (!this.dependencies.container.has(profilePhotoServiceToken)) {
        return null;
      }

      return resolveService<ProfilePhotoService>(this.dependencies, profilePhotoServiceToken);
    } catch {
      return null;
    }
  }

  private requirePhotos(): ProfilePhotoService {
    const photos = this.tryPhotos();

    if (!photos) {
      throw new Error("Profile photo service is not registered.");
    }

    return photos;
  }

  private async continueHtmlSession(
    request: Request,
    userId: number,
    location: string,
    message: string,
    options: { forgetOthers?: boolean } = {},
  ): Promise<Response> {
    const session = await issueHmacBrowserSession(request, userId);

    if (options.forgetOthers) {
      await forgetOtherBrowserSessions(userId, session.id);
    }

    const headers = new Headers({ Location: location });
    headers.append("Set-Cookie", session.header);

    return flashResponse(
      new Response(null, {
        status: 302,
        headers,
      }),
      {
        level: "success",
        message,
      },
    );
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
    request?: Request,
  ): Promise<Response> {
    const tokens = Array.isArray(extras.tokens)
      ? (extras.tokens as ApiTokenResource[])
      : await this.tokens.listTokensForUser(user.id);
    const authUser = currentAuthUser();

    return htmlResponse(
      await this.view.render("account/show", {
        title: "Account",
        user,
        tokens,
        availableAbilities: grantableTokenAbilities(
          authUser?.abilities ?? resolveAbilitiesForRole(authUser?.role ?? user.role),
        ),
        plainToken: null,
        mfaEnabled: Boolean(user.mfa_enabled),
        mfaFeatureEnabled: isFeatureEnabled("mfa"),
        pendingSecret: null,
        otpauthUrl: null,
        recoveryCodes: null,
        errors: {},
        ...extras,
        receivedInvitations:
          extras.receivedInvitations ?? (await this.invitations.listPendingForUser(user)),
        browserSessions:
          extras.browserSessions ?? (await listBrowserSessionsForUser(user.id, request)),
      }),
      { status },
    );
  }

  readonly show = withErrorHandling(async (request?: Request) => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    return await this.renderAccount(user, {}, 200, request);
  });

  readonly acceptInvitation = withErrorHandling(async (request: Request) => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    try {
      const membership = await this.invitations.acceptForUser(
        this.requireInvitationId(request),
        user,
      );

      return flashResponse(Response.redirect(`/organizations/${membership.organization_id}`, 302), {
        level: "success",
        message: "You joined the team.",
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        return flashResponse(Response.redirect("/account", 302), {
          level: "error",
          message: error.message,
        });
      }

      throw error;
    }
  });

  readonly declineInvitation = withErrorHandling(async (request: Request) => {
    const user = await this.users.findByIdOrThrow(this.requireUserId());

    try {
      await this.invitations.declineForUser(this.requireInvitationId(request), user);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Invitation declined.",
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        return flashResponse(Response.redirect("/account", 302), {
          level: "error",
          message: error.message,
        });
      }

      throw error;
    }
  });

  private requireInvitationId(request: Request): number {
    const params = (request as Request & { params?: { id: string } }).params;

    if (!params?.id) {
      throw new ValidationError("Id is required.");
    }

    return parsePositiveIntParam(params.id, "id");
  }

  readonly updateProfile = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebUpdateProfileBody(request);
      const result = await this.authService.updateProfile(userId, body.name, body.email);

      if (result.emailChanged && isFeatureEnabled("emailVerification")) {
        await this.passwordResets.sendEmailVerification(result.user);

        return flashResponse(Response.redirect("/email/verify", 302), {
          level: "success",
          message: "Profile updated. Check your email to verify the new address.",
        });
      }

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Profile updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      throw error;
    }
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
      const confirmed = await this.authService.confirmMfaSetup(userId, body.mfaCode);
      const user = await this.users.findByIdOrThrow(userId);

      return await this.renderAccount(user, {
        recoveryCodes: confirmed.recoveryCodes,
        errors: {},
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: normalizeFieldErrors(error.details) }, 422);
      }

      throw error;
    }
  });

  readonly regenerateRecoveryCodes = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebDisableMfaBody(request);
      const recoveryCodes = await this.authService.regenerateRecoveryCodes(userId, body.password);
      const user = await this.users.findByIdOrThrow(userId);

      return await this.renderAccount(user, { recoveryCodes });
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

  readonly logoutOtherDevices = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebDisableMfaBody(request);
      const revoked = await this.authService.logoutOtherDevices(userId, body.password);

      return this.continueHtmlSession(
        request,
        userId,
        "/account",
        revoked === 1
          ? "Revoked 1 other API token and signed out other browsers."
          : `Revoked ${revoked} other API tokens and signed out other browsers.`,
        { forgetOthers: true },
      );
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(user, { errors: { password: [error.message] } }, 422);
      }

      throw error;
    }
  });

  readonly logoutBrowserSession = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();
    const params = (request as Request & { params?: { id?: string } }).params;
    const sessionId = parseBrowserSessionId(params?.id);
    const current = readSession(request);
    const currentId = current ? hmacBrowserSessionId(current.userId, current.issuedAt) : null;

    if (currentId && sessionId === currentId) {
      const user = await this.users.findByIdOrThrow(userId);

      return await this.renderAccount(
        user,
        { errors: { session: ["Cannot log out this device."] } },
        422,
        request,
      );
    }

    const deleted = await forgetBrowserSessionById(userId, sessionId);

    if (!deleted) {
      const user = await this.users.findByIdOrThrow(userId);

      return await this.renderAccount(
        user,
        { errors: { session: ["That browser session is no longer active."] } },
        422,
        request,
      );
    }

    return flashResponse(Response.redirect("/account", 302), {
      level: "success",
      message: "Signed out that browser.",
    });
  });

  readonly changePassword = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebChangePasswordBody(request);
      await this.authService.changePassword(userId, body.currentPassword, body.password);

      return this.continueHtmlSession(request, userId, "/account", "Password updated.");
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
      const authUser = currentAuthUser();
      const created = await this.tokens.createToken(userId, {
        name: body.name,
        abilities: body.abilities,
        granterAbilities: authUser?.abilities ?? resolveAbilitiesForRole(authUser?.role),
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

  readonly updatePhoto = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const upload = await parseMultipartUpload(request, "photo");
      await this.requirePhotos().updatePhoto(userId, upload);

      return flashResponse(Response.redirect("/account", 302), {
        level: "success",
        message: "Profile photo updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError || error instanceof BadRequestError) {
        const user = await this.users.findByIdOrThrow(userId);

        return await this.renderAccount(
          user,
          {
            errors:
              error instanceof ValidationError
                ? normalizeFieldErrors(error.details)
                : { photo: [error.message] },
          },
          error instanceof ValidationError ? 422 : 400,
        );
      }

      throw error;
    }
  });

  readonly deletePhoto = withErrorHandling(async () => {
    const userId = this.requireUserId();
    await this.requirePhotos().deletePhoto(userId);

    return flashResponse(Response.redirect("/account", 302), {
      level: "success",
      message: "Profile photo removed.",
    });
  });

  readonly showPhoto = withErrorHandling(async () => {
    const photo = await this.requirePhotos().readPhoto(this.requireUserId());

    return new Response(photo.contents, {
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  });

  readonly deleteAccount = withErrorHandling(async (request: Request) => {
    const userId = this.requireUserId();

    try {
      const body = await parseWebDeleteAccountBody(request);
      const user = await this.users.findByIdOrThrow(userId);

      if (!user.password_hash || !(await verifyPassword(body.password, user.password_hash))) {
        throw new UnauthorizedError("Invalid credentials.");
      }

      await this.tryPhotos()?.deletePhoto(userId);
      await this.tokens.deleteUserAccount(userId);

      const session = readSession(request);

      if (session) {
        await forgetHmacBrowserSession(session.userId, session.issuedAt);
      }

      const headers = new Headers({ Location: "/login" });
      headers.append("Set-Cookie", clearSessionCookie());
      headers.append("Set-Cookie", clearPasswordConfirmCookie());

      return flashResponse(
        new Response(null, {
          status: 302,
          headers,
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
    "/account/profile": {
      POST: kernel.wrapWebAuthenticated(controller.updateProfile as unknown as RouteHandler),
    },
    "/account/photo": {
      GET: kernel.wrapWebAuthenticated(controller.showPhoto as unknown as RouteHandler),
      POST: kernel.wrapWebAuthenticated(controller.updatePhoto as unknown as RouteHandler),
    },
    "/account/photo/delete": {
      POST: kernel.wrapWebAuthenticated(controller.deletePhoto as unknown as RouteHandler),
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
    "/account/mfa/recovery-codes": {
      POST: kernel.wrapWebAuthenticated(
        controller.regenerateRecoveryCodes as unknown as RouteHandler,
      ),
    },
    "/account/password": {
      POST: kernel.wrapWebAuthenticated(controller.changePassword as unknown as RouteHandler),
    },
    "/account/logout-other-devices": {
      POST: kernel.wrapWebAuthenticated(controller.logoutOtherDevices as unknown as RouteHandler),
    },
    "/account/sessions/:id/logout": {
      POST: kernel.wrapWebAuthenticated(controller.logoutBrowserSession as unknown as RouteHandler),
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
      GET: kernel.wrapWebPasswordConfirm(controller.exportAccount as unknown as RouteHandler),
    },
    "/account/delete": {
      POST: kernel.wrapWebPasswordConfirm(controller.deleteAccount as unknown as RouteHandler),
    },
    "/account/invitations/:id/accept": {
      POST: kernel.wrapWebAuthenticated(controller.acceptInvitation as unknown as RouteHandler),
    },
    "/account/invitations/:id/decline": {
      POST: kernel.wrapWebAuthenticated(controller.declineInvitation as unknown as RouteHandler),
    },
  };
}

export default WebAccountController;
export { createWebAccountRoutes };
