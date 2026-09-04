import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import { ForbiddenError, NotFoundError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { authManager, denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { mergeResource, UserResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import type { UserRecord } from "../users/repository.ts";
import { otpauthQrDataUri } from "./otpauthQr.ts";
import {
  ConfirmPasswordRequest,
  CreateTokenRequest,
  MfaCodeRequest,
  UpdatePasswordRequest,
  UpdateProfileRequest,
} from "./requests.ts";
import { accountService } from "./service.ts";
import { tokenService } from "./tokenService.ts";

function requireStaff(user: UserRecord) {
  denyUnless(isStaff(user.role_id), "Staff only.");
}

function browserSessionPayload(
  rows: Awaited<ReturnType<ReturnType<typeof authManager>["store"]["listForUser"]>>,
  currentId: string | null,
) {
  return rows.map((row) => ({
    id: row.id,
    user_agent: row.user_agent,
    ip_address: row.ip_address,
    last_active_at: iso(row.last_active_at),
    expires_at: iso(row.expires_at),
    current: currentId === row.id,
  }));
}

export function accountRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/users/me": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse(
          mergeResource(new UserResource(user), {
            mfa_enabled: Boolean(user.mfa_enabled),
          }),
        );
      }),
      PATCH: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const payload = await new UpdateProfileRequest().validate(request);
        const updated = await accountService.updateProfile(
          user.id,
          payload.first_name,
          payload.last_name,
          payload.email,
        );
        return jsonResponse(new UserResource(updated).toArray());
      }),
    },
    "/api/users/me/password": {
      PUT: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const payload = await new UpdatePasswordRequest().validate(request);
        await accountService.changePassword(user.id, payload.current_password, payload.password);
        const store = authManager().store;
        const currentId = store.sessionIdFromRequest(request);
        if (currentId) {
          await store.destroyOtherSessions(user.id, currentId);
        }
        return jsonResponse({ message: "Password updated." });
      }),
    },
    "/api/users/me/confirm-password": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const payload = await new ConfirmPasswordRequest().validate(request);
        await accountService.confirmCurrentPassword(user.id, payload.password);
        return jsonResponse(
          { confirmed: true },
          { headers: { "Set-Cookie": createPasswordConfirmCookie(user.id) } },
        );
      }),
    },
    "/api/users/me/confirmed-password-status": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        return jsonResponse({
          confirmed: hasFreshPasswordConfirmation(request, user.id),
        });
      }),
    },
    "/api/users/me/sessions": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const store = authManager().store;
        const currentId = store.sessionIdFromRequest(request);
        return jsonResponse(browserSessionPayload(await store.listForUser(user.id), currentId));
      }),
    },
    "/api/users/me/sessions/:id": {
      DELETE: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const sessionId = String(
          (request as Request & { params?: { id?: string } }).params?.id ?? "",
        );
        const store = authManager().store;
        const listed = await store.listForUser(user.id);
        if (!listed.some((row) => row.id === sessionId)) {
          throw new NotFoundError("Session not found.");
        }
        const currentId = store.sessionIdFromRequest(request);
        await store.destroy(sessionId);
        if (sessionId === currentId) {
          return jsonResponse(
            { message: "Session revoked." },
            { headers: { "Set-Cookie": store.clearCookieHeader() } },
          );
        }
        return jsonResponse({ message: "Session revoked." });
      }),
    },
    "/api/users/me/logout-other-devices": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const payload = await new ConfirmPasswordRequest().validate(request);
        await accountService.confirmCurrentPassword(user.id, payload.password);
        const store = authManager().store;
        const currentId = store.sessionIdFromRequest(request);
        if (!currentId) {
          throw new ForbiddenError("No active session.");
        }
        await store.destroyOtherSessions(user.id, currentId);
        const revoked = await tokenService.revokeOtherTokens(user.id);
        return jsonResponse({ revoked });
      }),
    },
    "/api/users/me/mfa": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const setup = await accountService.beginMfaSetup(user);
        return jsonResponse({
          secret: setup.secret,
          otpauth_url: setup.otpauthUrl,
          qr: otpauthQrDataUri(setup.otpauthUrl),
        });
      }),
      DELETE: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const payload = await new ConfirmPasswordRequest().validate(request);
        await accountService.disableMfa(user.id, payload.password);
        return jsonResponse({ mfa_enabled: false });
      }),
    },
    "/api/users/me/mfa/confirm": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const payload = await new MfaCodeRequest().validate(request);
        const confirmed = await accountService.confirmMfaSetup(user.id, payload.mfa_code);
        return jsonResponse({
          mfa_enabled: true,
          recovery_codes: confirmed.recoveryCodes,
        });
      }),
    },
    "/api/users/me/mfa/recovery-codes": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const payload = await new ConfirmPasswordRequest().validate(request);
        const codes = await accountService.regenerateRecoveryCodes(user.id, payload.password);
        return jsonResponse({ recovery_codes: codes });
      }),
    },
    "/api/auth/tokens": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        return jsonResponse(await tokenService.listTokens(user.id));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const payload = await new CreateTokenRequest().validate(request);
        const created = await tokenService.createToken(user.id, payload);
        return jsonResponse(created, { status: 201 });
      }),
    },
    "/api/auth/tokens/:id": {
      DELETE: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        requireStaff(user);
        const tokenId = Number(
          (request as Request & { params?: { id?: string } }).params?.id ?? "",
        );
        await tokenService.revokeToken(user.id, tokenId);
        return jsonResponse({ message: "Token revoked." });
      }),
    },
  };
}
