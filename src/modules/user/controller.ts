import { CORE_AUTH_TOKEN } from "@getstrata/bootstrap/config";
import { resolveAbilitiesForRole } from "@getstrata/core/auth/abilityCatalog";
import type { AuthManager } from "@getstrata/core/auth/guard";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { UnauthorizedError, ValidationError } from "@getstrata/core/errors/http";
import { parseMultipartUpload } from "@getstrata/core/http/parseMultipartUpload";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "@getstrata/core/http/response";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";
import { appConfig } from "../../config/app";
import { isFeatureEnabled } from "../../config/features";
import { organizationServiceToken } from "../organization/provider";
import type OrganizationService from "../organization/service";
import ApiTokenRepository from "./apiTokenRepository";
import type AuthService from "./authService";
import {
  clearMfaChallengeCookie,
  createMfaChallenge,
  parseMfaChallengeValue,
  readMfaChallenge,
} from "./mfaChallengeCookie";
import { MfaRequiredError } from "./mfaRequiredError";
import type NotificationService from "./notificationService";
import OAuthIdentityRepository from "./oauthIdentityRepository";
import type PasswordResetService from "./passwordResetService";
import type ProfilePhotoService from "./profilePhotoService";
import { profilePhotoServiceToken } from "./profilePhotoService";
import {
  authServiceToken,
  notificationServiceToken,
  passwordResetServiceToken,
  tokenServiceToken,
} from "./provider";
import {
  type NotificationIdParams,
  type OAuthProviderParams,
  parseConfirmMfaBody,
  parseCreateApiTokenBody,
  parseForgotPasswordBody,
  parseLoginBody,
  parseNotificationIdParams,
  parseNotificationListQuery,
  parsePasswordChallengeBody,
  parseRegisterBody,
  parseResetPasswordBody,
  parseTokenIdParams,
  parseTwoFactorChallengeBody,
  parseUpdatePasswordBody,
  parseUpdateProfileBody,
  type TokenIdParams,
} from "./requests";
import { toNotificationResource, toUserResource } from "./resources";
import type TokenService from "./tokenService";
import type { CreatedApiToken } from "./types";

class AuthController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get auth(): AuthManager {
    return resolveService(this.dependencies, CORE_AUTH_TOKEN);
  }

  private get tokens(): TokenService {
    return resolveService(this.dependencies, tokenServiceToken);
  }

  private get authService(): AuthService {
    return resolveService(this.dependencies, authServiceToken);
  }

  private get passwordResets(): PasswordResetService {
    return resolveService(this.dependencies, passwordResetServiceToken);
  }

  private get notifications(): NotificationService {
    return resolveService(this.dependencies, notificationServiceToken);
  }

  private get organizations(): OrganizationService {
    return resolveService(this.dependencies, organizationServiceToken);
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

  private async requireUserId(request: Request): Promise<number> {
    const user = await this.auth.requireUser(request);
    const userId = typeof user.id === "number" ? user.id : Number(user.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Unauthorized");
    }

    return userId;
  }

  readonly login = withErrorHandling(async (request: Request) => {
    const body = await parseLoginBody(request);

    try {
      const created = await this.authService.loginWithPassword(body.email, body.password, {
        mfaCode: body.mfa_code,
      });

      return await this.loginTokenResponse(created);
    } catch (error) {
      if (error instanceof MfaRequiredError) {
        const challenge = createMfaChallenge(error.userId);

        return jsonResponse(
          {
            error: error.message,
            two_factor: true,
            mfa_pending: challenge.value,
          },
          {
            status: 401,
            headers: { "set-cookie": challenge.cookie },
          },
        );
      }

      throw error;
    }
  });

  readonly twoFactorChallenge = withErrorHandling(async (request: Request) => {
    const body = await parseTwoFactorChallengeBody(request);
    const challenge = parseMfaChallengeValue(body.mfa_pending) ?? readMfaChallenge(request);

    if (!challenge) {
      throw new UnauthorizedError("Two-factor authentication required.");
    }

    const created = await this.authService.loginWithMfaChallenge(challenge.userId, body.code);

    return await this.loginTokenResponse(created, {
      headers: { "set-cookie": clearMfaChallengeCookie() },
    });
  });

  private async loginTokenResponse(
    created: CreatedApiToken,
    init: ResponseInit = {},
  ): Promise<Response> {
    const authUser = await this.tokens.resolveUserFromToken(created.plainTextToken);

    if (!authUser) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const user = await this.tokens.findByIdOrThrow(Number(authUser.id));

    return createdResponse(
      {
        token: created.plainTextToken,
        user: toUserResource(user),
      },
      init,
    );
  }

  readonly register = withErrorHandling(async (request: Request) => {
    const body = await parseRegisterBody(request);
    const user = await this.authService.registerWithPassword(body.name, body.email, body.password);
    await this.organizations.createPersonalForUser(user);

    if (isFeatureEnabled("emailVerification")) {
      await this.passwordResets.sendEmailVerification(user);

      return createdResponse({
        user: toUserResource(user),
      });
    }

    const created = await this.authService.loginWithPassword(body.email, body.password);
    const authUser = await this.tokens.resolveUserFromToken(created.plainTextToken);

    if (!authUser) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const record = await this.tokens.findByIdOrThrow(Number(authUser.id));

    return createdResponse({
      token: created.plainTextToken,
      user: toUserResource(record),
    });
  });

  readonly forgotPassword = withErrorHandling(async (request: Request) => {
    const body = await parseForgotPasswordBody(request);
    await this.passwordResets.requestReset(body.email);

    return jsonResponse({
      message: "If that email exists, a reset link is on its way.",
    });
  });

  readonly resetPassword = withErrorHandling(async (request: Request) => {
    const body = await parseResetPasswordBody(request);
    await this.passwordResets.resetPassword(body.email, body.token, body.password);

    return jsonResponse({
      message: "Password updated. Sign in with your new password.",
    });
  });

  readonly resendVerification = withErrorHandling(async (request: Request) => {
    const body = await parseForgotPasswordBody(request);
    await this.passwordResets.requestEmailVerification(body.email);

    return jsonResponse({
      message: "If that account needs verification, a new link is on its way.",
    });
  });

  readonly oauthRedirect = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: OAuthProviderParams }).params;
    const provider = params?.provider;

    if (!provider) {
      throw new Error("OAuth provider is required.");
    }

    const { state, cookie } = createOAuthStateCookie();
    const url = this.authService.buildOAuthAuthorizationUrl(provider, state);

    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Set-Cookie": cookie,
      },
    });
  });

  readonly oauthCallback = withErrorHandling(async (request: Request) => {
    const params = (request as Request & { params?: OAuthProviderParams }).params;
    const provider = params?.provider;
    const callbackUrl = new URL(request.url);
    const code = callbackUrl.searchParams.get("code");
    const returnedState = callbackUrl.searchParams.get("state");

    if (!provider || !code) {
      throw new Error("OAuth provider and code are required.");
    }

    if (!verifyOAuthState(request, returnedState)) {
      throw new UnauthorizedError("Invalid OAuth state.");
    }

    const created = await this.authService.loginWithOAuth(provider, code);
    const authUser = await this.tokens.resolveUserFromToken(created.plainTextToken);

    if (!authUser) {
      throw new Error("Unable to resolve authenticated user.");
    }

    const user = await this.tokens.findByIdOrThrow(Number(authUser.id));
    await this.organizations.createPersonalForUser(user);

    return createdResponse(
      {
        token: created.plainTextToken,
        user: toUserResource(user),
      },
      {
        headers: {
          "Set-Cookie": clearOAuthStateCookie(),
        },
      },
    );
  });

  readonly me = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const record = await this.tokens.findByIdOrThrow(userId);
    return jsonResponse(toUserResource(record));
  });

  readonly updateProfile = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parseUpdateProfileBody(request);
    const result = await this.authService.updateProfile(userId, body.name, body.email);

    if (result.emailChanged && isFeatureEnabled("emailVerification")) {
      await this.passwordResets.sendEmailVerification(result.user);
    }

    return jsonResponse({
      user: toUserResource(result.user),
      email_changed: result.emailChanged,
    });
  });

  readonly updatePassword = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parseUpdatePasswordBody(request);

    try {
      const user = await this.authService.changePassword(
        userId,
        body.current_password,
        body.password,
      );

      return jsonResponse({ user: toUserResource(user) });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw new ValidationError("Invalid credentials.", {
          current_password: ["Invalid credentials."],
        });
      }

      throw error;
    }
  });

  readonly logoutOtherDevices = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parsePasswordChallengeBody(request);

    try {
      const revoked = await this.authService.logoutOtherDevices(userId, body.password);

      return jsonResponse({ revoked });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw new ValidationError("Invalid credentials.", {
          password: ["Invalid credentials."],
        });
      }

      throw error;
    }
  });

  readonly confirmPassword = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parsePasswordChallengeBody(request);
    await this.authService.confirmCurrentPassword(userId, body.password);

    return jsonResponse(
      { confirmed: true },
      { headers: { "set-cookie": createPasswordConfirmCookie(userId) } },
    );
  });

  readonly confirmedPasswordStatus = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);

    return jsonResponse({
      confirmed: hasFreshPasswordConfirmation(request, userId),
    });
  });

  readonly beginMfa = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const setup = await this.authService.beginMfaSetup(userId);

    return jsonResponse({
      secret: setup.secret,
      otpauth_url: setup.otpauthUrl,
    });
  });

  readonly confirmMfa = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parseConfirmMfaBody(request);
    const confirmed = await this.authService.confirmMfaSetup(userId, body.mfa_code);

    return jsonResponse({
      user: toUserResource(confirmed.user),
      recovery_codes: confirmed.recoveryCodes,
    });
  });

  readonly disableMfa = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parsePasswordChallengeBody(request);
    const user = await this.authService.disableMfa(userId, body.password);

    return jsonResponse({ user: toUserResource(user) });
  });

  readonly regenerateRecoveryCodes = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const body = await parsePasswordChallengeBody(request);
    const recoveryCodes = await this.authService.regenerateRecoveryCodes(userId, body.password);

    return jsonResponse({ recovery_codes: recoveryCodes });
  });

  readonly exportMe = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const user = await this.tokens.findByIdOrThrow(userId);
    const tokenRepo = new ApiTokenRepository();
    const oauthRepo = new OAuthIdentityRepository();

    const tokens = await tokenRepo.findAll({
      where: { user_id: userId },
    });
    const identities = await oauthRepo.findAll({
      where: { user_id: userId },
    });

    return jsonResponse({
      user: toUserResource(user),
      api_tokens: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        abilities: token.abilities,
        created_at: token.created_at.toISOString(),
      })),
      oauth_identities: identities.map((identity) => ({
        provider: identity.provider,
        email: identity.email,
        created_at: identity.created_at.toISOString(),
      })),
      exported_at: new Date().toISOString(),
    });
  });

  readonly deleteMe = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    await this.tryPhotos()?.deletePhoto(userId);
    await this.tokens.deleteUserAccount(userId);
    return noContentResponse();
  });

  readonly uploadPhoto = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const upload = await parseMultipartUpload(request, "photo");
    await this.requirePhotos().updatePhoto(userId, upload);

    return jsonResponse({
      photo_url: `${appConfig.apiPrefix}/users/me/photo`,
    });
  });

  readonly deletePhoto = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    await this.requirePhotos().deletePhoto(userId);

    return jsonResponse({ photo_url: null });
  });

  readonly showPhoto = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const photo = await this.requirePhotos().readPhoto(userId);

    return new Response(photo.contents, {
      headers: {
        "Content-Type": photo.contentType,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  });

  readonly listTokens = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    return jsonResponse({ data: await this.tokens.listTokensForUser(userId) });
  });

  readonly storeToken = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const user = await this.auth.requireUser(request);
    const body = await parseCreateApiTokenBody(request);
    const created = await this.tokens.createToken(userId, {
      name: body.name,
      abilities: body.abilities,
      granterAbilities: user.abilities ?? resolveAbilitiesForRole(user.role),
      expiresInDays: body.expires_in_days,
    });

    return createdResponse({
      token: created.plainTextToken,
      ...created.token,
    });
  });

  readonly destroyToken = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const params = (request as Request & { params?: TokenIdParams }).params;

    if (!params?.id) {
      throw new Error("Token id is required.");
    }

    const { id } = parseTokenIdParams(params);
    await this.tokens.revokeToken(userId, id);
    return noContentResponse();
  });

  readonly listNotifications = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const query = parseNotificationListQuery(request);
    const result = await this.notifications.listForUser(userId, query);

    return jsonResponse({
      data: result.data.map(toNotificationResource),
      meta: result.meta,
    });
  });

  readonly markNotificationRead = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const params = (request as Request & { params?: NotificationIdParams }).params;

    if (!params?.id) {
      throw new Error("Notification id is required.");
    }

    const { id } = parseNotificationIdParams(params);
    const notification = await this.notifications.markRead(userId, id);

    return jsonResponse(toNotificationResource(notification));
  });

  readonly markAllNotificationsRead = withErrorHandling(async (request: Request) => {
    const userId = await this.requireUserId(request);
    const updated = await this.notifications.markAllRead(userId);

    return jsonResponse({ updated });
  });
}

export default AuthController;
