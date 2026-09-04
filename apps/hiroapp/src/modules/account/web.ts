import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import {
  createPasswordConfirmCookie,
  hasFreshPasswordConfirmation,
} from "@getstrata/core/auth/passwordConfirmCookie";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { sanitizeInternalPath } from "@getstrata/core/http/safeInternalPath";
import { redirectResponse } from "@getstrata/core/view";
import { sessionMetaFromRequest, withCookies } from "../../http/cookies.ts";
import { authManager, denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated, wrapWebGuest, wrapWebPasswordConfirm } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { toSessionUser } from "../../lib/sessionUser.ts";
import { membershipsFor } from "../../lib/staffTeam.ts";
import { departments } from "../departments/repository.ts";
import { teamService } from "../teams/service.ts";
import { clearMfaChallengeCookie, readMfaChallenge } from "./mfaChallenge.ts";
import { otpauthQrDataUri } from "./otpauthQr.ts";
import { accountService } from "./service.ts";
import { tokenService } from "./tokenService.ts";

async function accountPage(request: Request, extras: Record<string, unknown> = {}) {
  const user = await requireCurrentUser(request);
  const staff = isStaff(user.role_id);
  const store = authManager().store;
  const currentId = store.sessionIdFromRequest(request);
  const sessions = staff
    ? (await store.listForUser(user.id)).map((row) => ({
        id: row.id,
        user_agent: row.user_agent ?? "Unknown",
        ip_address: row.ip_address ?? "",
        last_active_at: iso(row.last_active_at),
        current: row.id === currentId,
      }))
    : [];
  const tokens = staff ? await tokenService.listTokens(user.id) : [];
  const memberships = staff
    ? await Promise.all(
        (await membershipsFor(user.id)).map(async (row) => {
          const department = await departments.findById(row.department_id);
          return {
            id: Number(row.id),
            role: row.role,
            department_id: Number(row.department_id),
            name: department?.name ?? `Department ${row.department_id}`,
            current: Number(row.department_id) === Number(user.current_department_id),
          };
        }),
      )
    : [];
  const invitations = staff ? await teamService.receivedInvitations(user) : [];
  return renderPage(request, "account/show", {
    user,
    staff,
    sessions,
    tokens,
    memberships,
    invitations,
    mfaEnabled: Boolean(user.mfa_enabled),
    passwordConfirmed: hasFreshPasswordConfirmation(request, user.id),
    ...extras,
  });
}

export function accountWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/account": {
      GET: wrapWebAuthenticated(dependencies, (request) => accountPage(request)),
    },
    "/account/profile": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        try {
          await accountService.updateProfile(
            user.id,
            fields.first_name ?? "",
            fields.last_name ?? "",
            fields.email ?? "",
          );
        } catch {
          return accountPage(request, {
            errors: { profile: "Could not update profile." },
          });
        }
        return flashResponse(redirectResponse("/account#profile"), {
          level: "success",
          message: "Profile updated.",
        });
      }),
    },
    "/account/password": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        if ((fields.password ?? "") !== (fields.password_confirmation ?? "")) {
          return accountPage(request, {
            errors: { password: "The password confirmation does not match." },
          });
        }
        try {
          await accountService.changePassword(
            user.id,
            fields.current_password ?? "",
            fields.password ?? "",
          );
          const store = authManager().store;
          const currentId = store.sessionIdFromRequest(request);
          if (currentId) {
            await store.destroyOtherSessions(user.id, currentId);
          }
        } catch {
          return accountPage(request, {
            errors: { password: "Current password is incorrect." },
          });
        }
        return flashResponse(redirectResponse("/account#password"), {
          level: "success",
          message: "Password updated.",
        });
      }),
    },
    "/account/mfa": {
      POST: wrapWebPasswordConfirm(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const setup = await accountService.beginMfaSetup(user);
        return accountPage(request, {
          mfaSecret: setup.secret,
          mfaQr: otpauthQrDataUri(setup.otpauthUrl),
          otpauthUrl: setup.otpauthUrl,
        });
      }),
    },
    "/account/mfa/confirm": {
      POST: wrapWebPasswordConfirm(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const { fields } = await parseFormBody(request);
        try {
          const confirmed = await accountService.confirmMfaSetup(user.id, fields.mfa_code ?? "");
          return accountPage(request, { recoveryCodes: confirmed.recoveryCodes, mfaEnabled: true });
        } catch {
          return accountPage(request, { errors: { mfa: "Invalid MFA code." } });
        }
      }),
    },
    "/account/mfa/disable": {
      POST: wrapWebPasswordConfirm(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const { fields } = await parseFormBody(request);
        await accountService.disableMfa(user.id, fields.password ?? "");
        return flashResponse(redirectResponse("/account#mfa"), {
          level: "success",
          message: "Two-factor authentication disabled.",
        });
      }),
    },
    "/account/logout-other-devices": {
      POST: wrapWebPasswordConfirm(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const { fields } = await parseFormBody(request);
        await accountService.confirmCurrentPassword(user.id, fields.password ?? "");
        const store = authManager().store;
        const currentId = store.sessionIdFromRequest(request);
        if (currentId) {
          await store.destroyOtherSessions(user.id, currentId);
        }
        await tokenService.revokeOtherTokens(user.id);
        return flashResponse(redirectResponse("/account#sessions"), {
          level: "success",
          message: "Other devices have been logged out.",
        });
      }),
    },
    "/account/sessions/:id/logout": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const sessionId = routeParams(request).id ?? "";
        const store = authManager().store;
        const currentId = store.sessionIdFromRequest(request);
        await store.destroy(sessionId);
        if (sessionId === currentId) {
          return authManager().signOutRedirect(request, "/login", 302);
        }
        return flashResponse(redirectResponse("/account#sessions"), {
          level: "success",
          message: "Session revoked.",
        });
      }),
    },
    "/account/tokens": {
      POST: wrapWebPasswordConfirm(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const { fields } = await parseFormBody(request);
        const created = await tokenService.createToken(user.id, {
          name: fields.name?.trim() || "API token",
        });
        return accountPage(request, { plainTextToken: created.plainTextToken });
      }),
    },
    "/account/tokens/:id/revoke": {
      POST: wrapWebPasswordConfirm(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        await tokenService.revokeToken(user.id, Number(routeParams(request).id));
        return flashResponse(redirectResponse("/account#tokens"), {
          level: "success",
          message: "Token revoked.",
        });
      }),
    },
    "/account/current-department": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const { fields } = await parseFormBody(request);
        await teamService.switchCurrentDepartment(user, Number(fields.department_id));
        return flashResponse(redirectResponse("/account#team"), {
          level: "success",
          message: "Current hiring team updated.",
        });
      }),
    },
    "/account/invitations/:id/accept": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        await teamService.acceptInvitation(user, Number(routeParams(request).id));
        return flashResponse(redirectResponse("/account#team"), {
          level: "success",
          message: "Invitation accepted.",
        });
      }),
    },
    "/account/invitations/:id/decline": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        await teamService.declineInvitation(user, Number(routeParams(request).id));
        return flashResponse(redirectResponse("/account#team"), {
          level: "success",
          message: "Invitation declined.",
        });
      }),
    },
    "/confirm-password": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const url = new URL(request.url);
        return renderPage(
          request,
          "auth/confirm-password",
          { redirect: url.searchParams.get("redirect") ?? "/account", errors: {} },
          200,
          false,
        );
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        const redirect = sanitizeInternalPath(fields.redirect ?? "/account", "/account");
        try {
          await accountService.confirmCurrentPassword(user.id, fields.password ?? "");
        } catch {
          return renderPage(
            request,
            "auth/confirm-password",
            { redirect, errors: { password: "Invalid password." } },
            422,
            false,
          );
        }
        return withCookies(redirectResponse(redirect), [createPasswordConfirmCookie(user.id)]);
      }),
    },
    "/two-factor-challenge": {
      GET: wrapWebGuest(dependencies, async (request) => {
        if (!readMfaChallenge(request)) {
          return redirectResponse("/login");
        }
        const url = new URL(request.url);
        return renderPage(
          request,
          "auth/two-factor-challenge",
          { errors: {}, redirect: url.searchParams.get("redirect") ?? "/" },
          200,
          false,
        );
      }),
      POST: wrapWebGuest(dependencies, async (request) => {
        const pending = readMfaChallenge(request);
        if (!pending) {
          return redirectResponse("/login");
        }
        const { fields } = await parseFormBody(request);
        try {
          const user = await accountService.verifyMfaChallenge(
            pending.userId,
            fields.mfa_code ?? "",
          );
          const signedIn = await authManager().signInRedirect(
            toSessionUser(user),
            sanitizeInternalPath(fields.redirect ?? "/", "/"),
            302,
            sessionMetaFromRequest(request),
          );
          return withCookies(signedIn, [clearMfaChallengeCookie()]);
        } catch {
          return renderPage(
            request,
            "auth/two-factor-challenge",
            { errors: { mfa_code: "Invalid MFA code." }, redirect: fields.redirect ?? "/" },
            422,
            false,
          );
        }
      }),
    },
  };
}
