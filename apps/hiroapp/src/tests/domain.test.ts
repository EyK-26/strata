import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { setActiveApplicationContext } from "@getstrata/bootstrap/applicationRegistry";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@getstrata/core/errors/http";
import { appDevSecret } from "@getstrata/core/runtime/appKeyPrefix";
import { hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { generateTotp } from "@getstrata/core/security/totp";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { recordHiringEvent } from "../lib/hiringEvents.ts";
import { isAdmin, isCandidate, isRecruiter, isStaff, ROLE, roleName } from "../lib/roles.ts";
import { toSessionUser } from "../lib/sessionUser.ts";
import {
  canManageTeam,
  membershipsFor,
  requireStaffDepartmentAccess,
  resolveStaffDepartmentId,
} from "../lib/staffTeam.ts";
import {
  clearMfaChallengeCookie,
  createMfaChallengeCookie,
  readMfaChallenge,
} from "../modules/account/mfaChallenge.ts";
import { otpauthQrDataUri } from "../modules/account/otpauthQr.ts";
import { accountService } from "../modules/account/service.ts";
import { apiTokens } from "../modules/account/tokenRepository.ts";
import { normalizeAbilities, tokenService } from "../modules/account/tokenService.ts";
import { applications } from "../modules/applications/repository.ts";
import { auditService } from "../modules/audit/service.ts";
import { billingService } from "../modules/billing/service.ts";
import { comments } from "../modules/comments/repository.ts";
import { departments } from "../modules/departments/repository.ts";
import { notifications } from "../modules/notifications/repository.ts";
import {
  contactUserNotification,
  endedNotification,
  hiredNotification,
  interviewNotification,
  notifyUser,
} from "../modules/notifications/service.ts";
import { positions } from "../modules/positions/repository.ts";
import { isCandidateShaped, scimService } from "../modules/scim/service.ts";
import { skills } from "../modules/skills/repository.ts";
import { departmentInvitations } from "../modules/teams/invitationRepository.ts";
import { teamService } from "../modules/teams/service.ts";
import { users } from "../modules/users/repository.ts";
import { webhooks } from "../modules/webhooks/repository.ts";
import { webhookService } from "../modules/webhooks/service.ts";
import { bootHiroapp } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

async function seededUser(email: string) {
  const user = await users.findByEmail(email);
  if (!user) {
    throw new Error(`missing seeded user ${email}`);
  }
  return user;
}

describe.skipIf(!enabled)("Wave 10 HiroApp domain coverage", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("staff team resolution falls back across membership and occupied seats", async () => {
    const admin = await seededUser("admin@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const memberships = await membershipsFor(admin.id);
    expect(memberships.length).toBeGreaterThan(0);
    const current = await resolveStaffDepartmentId(admin);
    const membershipIds = memberships.map((row) => Number(row.department_id));
    if (
      admin.current_department_id &&
      membershipIds.includes(Number(admin.current_department_id))
    ) {
      expect(current).toBe(Number(admin.current_department_id));
    } else {
      expect(current).toBe(membershipIds[0]);
    }

    const cleared = await users.updateByIdOrThrow(recruiter.id, { current_department_id: null });
    const fromMembership = await resolveStaffDepartmentId(cleared);
    expect(fromMembership).toBeTruthy();
    await users.updateById(recruiter.id, { current_department_id: fromMembership });

    await requireStaffDepartmentAccess(admin, Number(fromMembership));
    await expect(
      requireStaffDepartmentAccess(candidate, Number(fromMembership)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireStaffDepartmentAccess(admin, 9_999_999)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(requireStaffDepartmentAccess(recruiter, 9_999_999)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await canManageTeam(admin, Number(fromMembership))).toBe(true);
    expect(await canManageTeam(recruiter, Number(fromMembership))).toBe(false);

    const seatUser = await seededUser("candidate@hiroapp.com");
    const occupied = await positions.findByUserId(seatUser.id);
    if (!occupied) {
      const hiring = await positions.hiring();
      const open = hiring[0];
      if (!open) {
        throw new Error("no hiring position");
      }
      await positions.updateByIdOrThrow(open.id, { user_id: seatUser.id });
    }
    const isolated = { ...candidate, current_department_id: null, role_id: ROLE.RECRUITER };
    const fromSeat = await resolveStaffDepartmentId(isolated);
    expect(fromSeat).toBeTruthy();
  });

  test("repositories cover search, hiring filters, and missing-row updates", async () => {
    const found = await users.search("Hiro");
    expect(found.some((row) => row.email.includes("hiroapp.com"))).toBe(true);
    const admin = await seededUser("admin@hiroapp.com");
    expect((await users.search("", [admin.id])).some((row) => row.id === admin.id)).toBe(true);
    expect((await users.search("Hiro", [admin.id])).some((row) => row.id === admin.id)).toBe(true);
    await applications.deleteForPosition(9_999_999);
    expect(await users.countByEmailPrefix("admin@")).toBeGreaterThan(0);
    expect(await users.updateById(9_999_999, { first_name: "Nope" })).toBeNull();
    expect(await users.deleteById(9_999_999)).toBe(false);

    const hiring = await positions.hiring({ search: "Engineer", departmentId: 1 });
    expect(Array.isArray(hiring)).toBe(true);
    expect((await positions.distinctNames()).length).toBeGreaterThan(0);
    expect((await positions.hiringInDepartment(1)).length).toBeGreaterThan(0);
    expect((await positions.idsInDepartment(1)).length).toBeGreaterThan(0);
    expect(Array.isArray(await positions.occupiedUserIds(1))).toBe(true);

    const apps = await applications.forPosition(hiring[0]?.id ?? 1);
    expect(Array.isArray(apps)).toBe(true);
    expect(await applications.forPositions([])).toEqual([]);
    expect(await applications.countForPositions([])).toBe(0);
    if (apps[0]) {
      expect(await applications.findPair(apps[0].user_id, apps[0].position_id ?? 0)).toBeTruthy();
      expect((await applications.forPositions([apps[0].position_id ?? 1])).length).toBeGreaterThan(
        0,
      );
      expect(await applications.countForPositions([apps[0].position_id ?? 1])).toBeGreaterThan(0);
    }

    const tokens = await tokenService.listTokens(admin.id);
    const created = await tokenService.createToken(admin.id, {
      name: "coverage",
      abilities: ["read"],
      expiresInDays: 1,
    });
    expect(created.plainTextToken.length).toBeGreaterThan(10);
    const hashed = await apiTokens.findByTokenHash(hashApiToken(created.plainTextToken));
    expect(hashed?.id).toBe(created.token.id);
    await tokenService.revokeOtherTokens(admin.id, created.token.id);
    await expect(tokenService.revokeToken(admin.id, 9_999_999)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await tokenService.revokeToken(admin.id, created.token.id);
    expect(tokens.length).toBeGreaterThanOrEqual(0);

    const keep = await tokenService.createToken(admin.id, { name: "keep" });
    const extra = await tokenService.createToken(admin.id, { name: "drop" });
    await tokenService.revokeOtherTokens(admin.id, keep.token.id);
    expect((await tokenService.listTokens(admin.id)).some((row) => row.id === extra.token.id)).toBe(
      false,
    );
    await tokenService.revokeToken(admin.id, keep.token.id);

    const stringAbilities = await tokenService.createToken(admin.id, { name: "json-abilities" });
    await apiTokens.updateByIdOrThrow(stringAbilities.token.id, { abilities: '["jobs"]' as never });
    const listed = await tokenService.listTokens(admin.id);
    expect(
      listed.some((row) => row.abilities.includes("jobs") || row.abilities.includes("*")),
    ).toBe(true);
    await db`UPDATE api_token SET abilities = '"not-json"'::jsonb WHERE id = ${stringAbilities.token.id}`;
    expect(
      (await tokenService.listTokens(admin.id)).some((row) => row.id === stringAbilities.token.id),
    ).toBe(true);
    await tokenService.revokeToken(admin.id, stringAbilities.token.id);
    expect(normalizeAbilities(["read", "write"])).toEqual(["read", "write"]);
    expect(normalizeAbilities('["read"]')).toEqual(["read"]);
    expect(normalizeAbilities("not-json")).toEqual(["*"]);
    expect(normalizeAbilities("{}")).toEqual(["*"]);
    expect(normalizeAbilities(null)).toEqual(["*"]);
    expect(normalizeAbilities(12)).toEqual(["*"]);
  });

  test("account service covers profile, password, and MFA branches", async () => {
    const recruiter = await seededUser("recruiter@hiroapp.com");
    await expect(
      accountService.updateProfile(recruiter.id, "Recruiter", "Hiro", "admin@hiroapp.com"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      accountService.changePassword(recruiter.id, "wrong", "password2"),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      accountService.changePassword(recruiter.id, "password", "password"),
    ).rejects.toBeInstanceOf(ValidationError);
    await accountService.confirmCurrentPassword(recruiter.id, "password");
    await expect(
      accountService.confirmCurrentPassword(recruiter.id, "nope"),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const candidate = await seededUser("candidate@hiroapp.com");
    expect(accountService.staffRequiresMfa(candidate)).toBe(false);
    await expect(accountService.verifyMfaChallenge(candidate.id, "000000")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    const setup = await accountService.beginMfaSetup(recruiter);
    await expect(accountService.confirmMfaSetup(recruiter.id, "000000")).rejects.toBeInstanceOf(
      ValidationError,
    );
    const code = generateTotp(setup.secret, Math.floor(Date.now() / 30_000));
    const confirmed = await accountService.confirmMfaSetup(recruiter.id, code);
    expect(confirmed.recoveryCodes.length).toBeGreaterThan(0);
    expect(accountService.staffRequiresMfa(await users.findByIdOrThrow(recruiter.id))).toBe(true);
    const totp = generateTotp(setup.secret, Math.floor(Date.now() / 30_000));
    expect((await accountService.verifyMfaChallenge(recruiter.id, totp)).id).toBe(recruiter.id);
    await expect(
      accountService.beginMfaSetup(await users.findByIdOrThrow(recruiter.id)),
    ).rejects.toBeInstanceOf(ValidationError);
    const recoveryCode = confirmed.recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error("missing recovery code");
    }
    await expect(accountService.verifyMfaChallenge(recruiter.id, "")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    const recovered = await accountService.verifyMfaChallenge(recruiter.id, recoveryCode);
    expect(recovered.mfa_enabled).toBe(true);
    await expect(accountService.verifyMfaChallenge(recruiter.id, "000000")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await users.updateById(recruiter.id, { mfa_recovery_codes: null });
    await expect(accountService.verifyMfaChallenge(recruiter.id, "000000")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(
      accountService.regenerateRecoveryCodes(candidate.id, "password"),
    ).rejects.toBeInstanceOf(ValidationError);
    const nextCodes = await accountService.regenerateRecoveryCodes(recruiter.id, "password");
    expect(nextCodes.length).toBeGreaterThan(0);
    await users.updateById(recruiter.id, { mfa_recovery_codes: "not-json" });
    await expect(
      accountService.verifyMfaChallenge(recruiter.id, "recovery"),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await users.updateById(recruiter.id, { mfa_recovery_codes: "{}" });
    await expect(
      accountService.verifyMfaChallenge(recruiter.id, "recovery"),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    const lastCodes = await accountService.regenerateRecoveryCodes(recruiter.id, "password");
    const lastCode = lastCodes[0];
    if (!lastCode) {
      throw new Error("missing last recovery code");
    }
    await users.updateById(recruiter.id, {
      mfa_recovery_codes: JSON.stringify([hashRecoveryCode(lastCode)]),
    });
    expect((await accountService.verifyMfaChallenge(recruiter.id, lastCode)).mfa_enabled).toBe(
      true,
    );
    const uniqueEmail = `recruiter.coverage.${Date.now()}@hiroapp.com`;
    await accountService.updateProfile(recruiter.id, "Recruiter", "Hiro", uniqueEmail);
    await accountService.updateProfile(recruiter.id, "Recruiter", "Hiro", uniqueEmail);
    await accountService.updateProfile(recruiter.id, "Recruiter", "Hiro", "recruiter@hiroapp.com");
    await accountService.changePassword(recruiter.id, "password", "password-next");
    await accountService.changePassword(recruiter.id, "password-next", "password");
    await accountService.disableMfa(recruiter.id, "password");
  });

  test("MFA challenge cookies accept only a valid signed payload", () => {
    const previousTtl = process.env.MFA_CHALLENGE_TTL_SECONDS;
    const previousName = process.env.MFA_CHALLENGE_COOKIE_NAME;
    const previousEnv = process.env.APP_ENV;
    process.env.MFA_CHALLENGE_TTL_SECONDS = "60";
    process.env.MFA_CHALLENGE_COOKIE_NAME = "hiroapp_mfa_pending";
    process.env.APP_ENV = "production";
    const cookie = createMfaChallengeCookie(3);
    expect(cookie).toContain("Secure");
    expect(readMfaChallenge(new Request("http://localhost/login"))).toBeNull();
    expect(
      readMfaChallenge(new Request("http://localhost/login", { headers: { cookie: "other=1" } })),
    ).toBeNull();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", { headers: { cookie: "hiroapp_mfa_pending=a.b" } }),
      ),
    ).toBeNull();
    const now = Date.now();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=0.${now}.sig` },
        }),
      ),
    ).toBeNull();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=3..sig` },
        }),
      ),
    ).toBeNull();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=3.${now}.` },
        }),
      ),
    ).toBeNull();
    const value = cookie.split("=", 2)[1]?.split(";", 1)[0] ?? "";
    const decoded = decodeURIComponent(value);
    const [cookieUserId, cookieIssuedAt] = decoded.split(".");
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=${cookieUserId}.${cookieIssuedAt}.deadbeef` },
        }),
      ),
    ).toBeNull();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: {
            cookie: `hiroapp_mfa_pending=${cookieUserId}.${cookieIssuedAt}.${"ab".repeat(32)}`,
          },
        }),
      ),
    ).toBeNull();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=${encodeURIComponent(decoded)}` },
        }),
      ),
    ).toEqual({ userId: 3 });
    const pastIssuedAt = Date.now() - 120_000;
    const payload = `3.${pastIssuedAt}`;
    const signature = createHmac(
      "sha256",
      process.env.SESSION_SECRET?.trim() || appDevSecret("session-secret"),
    )
      .update(payload)
      .digest("hex");
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=${payload}.${signature}` },
        }),
      ),
    ).toBeNull();
    expect(
      readMfaChallenge(
        new Request("http://localhost/login", {
          headers: { cookie: `hiroapp_mfa_pending=${payload}.ab` },
        }),
      ),
    ).toBeNull();
    expect(clearMfaChallengeCookie()).toContain("Max-Age=0");
    process.env.APP_ENV = "testing";
    expect(createMfaChallengeCookie(3)).not.toContain("Secure");
    if (previousTtl === undefined) {
      delete process.env.MFA_CHALLENGE_TTL_SECONDS;
    } else {
      process.env.MFA_CHALLENGE_TTL_SECONDS = previousTtl;
    }
    if (previousName === undefined) {
      delete process.env.MFA_CHALLENGE_COOKIE_NAME;
    } else {
      process.env.MFA_CHALLENGE_COOKIE_NAME = previousName;
    }
    if (previousEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousEnv;
    }
    const previousTtlInvalid = process.env.MFA_CHALLENGE_TTL_SECONDS;
    const previousNameEmpty = process.env.MFA_CHALLENGE_COOKIE_NAME;
    process.env.MFA_CHALLENGE_TTL_SECONDS = "nope";
    process.env.MFA_CHALLENGE_COOKIE_NAME = "";
    expect(createMfaChallengeCookie(3)).toContain("hiroapp_mfa_pending=");
    if (previousTtlInvalid === undefined) {
      delete process.env.MFA_CHALLENGE_TTL_SECONDS;
    } else {
      process.env.MFA_CHALLENGE_TTL_SECONDS = previousTtlInvalid;
    }
    if (previousNameEmpty === undefined) {
      delete process.env.MFA_CHALLENGE_COOKIE_NAME;
    } else {
      process.env.MFA_CHALLENGE_COOKIE_NAME = previousNameEmpty;
    }
  });

  test("team service covers add/remove/invite edge cases", async () => {
    const admin = await seededUser("admin@hiroapp.com");
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const candidate = await seededUser("candidate@hiroapp.com");
    const department = (await departments.ordered())[0];
    if (!department) {
      throw new Error("no department");
    }
    const departmentId = Number(department.id);
    await expect(
      teamService.addMember(recruiter, departmentId, recruiter.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teamService.addMember(admin, departmentId, candidate.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const extra = await scimService.createUser({
      userName: `coverage.staff.${Date.now()}@hiroapp.com`,
      name: { formatted: "Coverage Staff" },
      roles: ["recruiter"],
    });
    if ("ignored" in extra) {
      throw new Error("expected staff user");
    }
    const extraId = Number(extra.id);
    const added = await teamService.addMember(admin, departmentId, extraId, "member");
    expect(added.user_id).toBe(extraId);
    const again = await teamService.addMember(admin, departmentId, extraId);
    expect(Number(again.id)).toBe(Number(added.id));
    await teamService.removeMember(admin, departmentId, extraId);
    await expect(teamService.removeMember(admin, departmentId, extraId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      teamService.removeMember(recruiter, departmentId, admin.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      teamService.invite(recruiter, departmentId, "x@hiroapp.com"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teamService.invite(admin, departmentId, "   ")).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(teamService.invite(admin, departmentId, candidate.email)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(teamService.invite(admin, departmentId, recruiter.email)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const invited = await teamService
      .invite(admin, departmentId, `invite.coverage.${Date.now()}@hiroapp.com`, "nope")
      .catch((error) => error);
    expect(invited).toBeInstanceOf(ValidationError);
    const mail = await teamService.invite(
      admin,
      departmentId,
      `invite.ok.${Date.now()}@hiroapp.com`,
      "member",
    );
    const againInvite = await teamService.invite(
      admin,
      departmentId,
      mail.invitation.email,
      "member",
    );
    expect(againInvite.invitation.email).toBe(mail.invitation.email);
    expect((await teamService.listInvitations(admin, departmentId)).length).toBeGreaterThan(0);

    const staffUser = await users.findByIdOrThrow(extraId);
    await users.updateById(extraId, { email: mail.invitation.email });
    const received = await teamService.receivedInvitations({
      ...staffUser,
      email: mail.invitation.email,
    });
    expect(received.length).toBeGreaterThan(0);
    await expect(
      teamService.acceptInvitation(candidate, mail.invitation.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teamService.acceptInvitation(staffUser, 9_999_999)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await departmentInvitations.updateByIdOrThrow(againInvite.invitation.id, {
      expires_at: new Date(Date.now() - 1000),
    });
    const expiredUser = await users.findByIdOrThrow(extraId);
    await expect(
      teamService.acceptInvitation(
        { ...expiredUser, email: mail.invitation.email },
        againInvite.invitation.id,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const fresh = await teamService.invite(
      admin,
      departmentId,
      `invite.accept.${Date.now()}@hiroapp.com`,
    );
    await users.updateById(extraId, { email: fresh.invitation.email });
    const acceptor = await users.findByIdOrThrow(extraId);
    await teamService.acceptInvitation(
      { ...acceptor, email: fresh.invitation.email },
      fresh.invitation.id,
    );
    const other = await teamService.invite(
      admin,
      departmentId,
      `invite.decline.${Date.now()}@hiroapp.com`,
    );
    await expect(teamService.declineInvitation(admin, other.invitation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await users.updateById(extraId, { email: other.invitation.email });
    const decliner = await users.findByIdOrThrow(extraId);
    await teamService.declineInvitation(
      { ...decliner, email: other.invitation.email },
      other.invitation.id,
    );
    await teamService.switchCurrentDepartment(admin, departmentId);
    await expect(teamService.switchCurrentDepartment(recruiter, 9_999_999)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("SCIM service covers name split, patch, groups, and ignores", async () => {
    expect(isCandidateShaped({ userType: "applicant" })).toBe(true);
    expect(isCandidateShaped({ roles: ["candidate"] })).toBe(true);
    expect(scimService.serviceProviderConfig().patch.supported).toBe(true);
    const page = await scimService.listUsers(1, 1);
    expect(page.itemsPerPage).toBe(1);
    const admin = await seededUser("admin@hiroapp.com");
    expect((await scimService.getUser(admin.id)).userName).toBe(admin.email);
    await expect(scimService.getUser(9_999_999)).rejects.toBeInstanceOf(NotFoundError);
    expect(await scimService.createUser({ userType: "candidate" })).toEqual({ ignored: true });
    await expect(scimService.createUser({ name: { formatted: "Nobody" } })).rejects.toThrow(
      "SCIM userName or email is required.",
    );
    expect(
      await scimService.createUser({
        emails: [{ value: "candidate@hiroapp.com", primary: true }],
      }),
    ).toEqual({ ignored: true });
    const viaEmail = await scimService.createUser({
      emails: [
        { value: `scim.primary.${Date.now()}@hiroapp.com`, primary: false },
        { value: `scim.work.${Date.now()}@hiroapp.com`, primary: true },
      ],
      name: { givenName: "Work", familyName: "Email" },
    });
    if (!("ignored" in viaEmail)) {
      await scimService.deleteUser(Number(viaEmail.id));
    }
    expect((await scimService.createUser({ userName: admin.email })).id).toBe(String(admin.id));
    const created = await scimService.createUser({
      userName: `scim.admin.${Date.now()}@hiroapp.com`,
      name: { familyName: "Solo" },
      roles: ["admin"],
    });
    if ("ignored" in created) {
      throw new Error("expected admin");
    }
    const patched = await scimService.patchUser(Number(created.id), [
      { op: "add", path: "displayName", value: "Skip" },
      { op: "replace", path: "displayName", value: "" },
      { op: "replace", path: "displayName", value: "Patched Name" },
      { op: "replace", path: "userName", value: created.userName },
      { op: "replace", path: 'emails[type eq "work"].value', value: created.userName },
    ]);
    expect(patched.name.givenName).toBe("Patched");
    const emptyPage = await scimService.listGroups(500, 1);
    expect(emptyPage.itemsPerPage).toBe(0);
    const firstDept = (await departments.ordered())[0];
    if (!firstDept) {
      throw new Error("no department");
    }
    expect((await scimService.getGroup(firstDept.id)).displayName).toBe(firstDept.name);
    await expect(scimService.getGroup(9_999_999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(scimService.patchGroup(9_999_999, [])).rejects.toBeInstanceOf(NotFoundError);
    await scimService.patchGroup(firstDept.id, [
      { op: "replace", path: "members", value: [] },
      { op: "add", path: "members", value: { value: created.id } },
      { op: "add", path: "members" },
      { op: "add", path: "members", value: [{ value: "nope" }, { value: String(admin.id) }] },
    ]);
    await scimService.deleteUser(Number(created.id));
  });

  test("webhooks, billing, and notifications cover remaining branches", async () => {
    await expect(webhookService.requireWebhook(9_999_999)).rejects.toBeInstanceOf(NotFoundError);
    const created = await webhookService.create({
      url: "https://example.com/coverage-hooks",
      secret: "secret",
      events: ["application.submitted"],
      departmentId: 1,
    });
    await webhookService.dispatch("application.hired", { department_id: 1 });
    await webhookService.dispatch("application.submitted", { department_id: 2 });
    await webhookService.dispatch("application.submitted", { department_id: 1 });
    await webhooks.updateByIdOrThrow(created.id, { events: "*" as never });
    await webhookService.dispatch("application.submitted", { department_id: 1 });
    expect((await webhookService.listAll()).some((row) => row.id === created.id)).toBe(true);
    expect((await webhookService.listRecentDeliveries(5)).length).toBeGreaterThanOrEqual(0);
    await webhookService.deactivate(created.id);
    await webhookService.activate(created.id);
    await webhookService.delete(created.id);

    const wildcard = await webhookService.create({
      url: "https://example.com/coverage-star",
      secret: "secret",
    });
    await webhookService.dispatch("team.invited", {});
    await webhookService.delete(wildcard.id);

    await runWithMigrationBypass(async () => {
      const duplicate = await billingService.rememberStripeEvent("evt_coverage", "ping", 1);
      expect(duplicate).toBe(false);
      expect(await billingService.rememberStripeEvent("evt_coverage", "ping", 1)).toBe(true);
      await billingService.upsertSubscription({ tenantId: 1, plan: "pro", status: "active" });
      await db`DELETE FROM subscription WHERE tenant_id = 1`;
      const createdSub = await billingService.upsertSubscription({
        tenantId: 1,
        plan: "enterprise",
        stripeSubscriptionId: "sub_coverage",
      });
      expect(createdSub.plan).toBe("enterprise");
    });

    const recruiter = await seededUser("recruiter@hiroapp.com");
    expect(contactUserNotification("a", "b", "s", "t").email.to).toBe("b");
    expect(
      interviewNotification({
        text: "panel",
        datetime: "not-a-date",
        place: "Office",
        sender: recruiter,
        to: "candidate@hiroapp.com",
      }).email.body,
    ).toContain("not-a-date");
    expect(
      interviewNotification({
        text: "panel",
        datetime: "2026-09-10T10:00:00.000Z",
        place: "Office",
        sender: recruiter,
        to: "candidate@hiroapp.com",
      }).email.body,
    ).toContain("2026-09-10");
    expect(
      endedNotification({
        firstName: "Pat",
        positionName: "Engineer",
        recruiter: recruiter,
        to: "candidate@hiroapp.com",
      }).type,
    ).toContain("ApplicationEnded");
    expect(
      hiredNotification({
        firstName: "Pat",
        positionName: "Engineer",
        recruiter: recruiter,
        to: "candidate@hiroapp.com",
      }).type,
    ).toContain("AcceptedForPosition");
    await notifyUser({
      userId: recruiter.id,
      type: "coverage",
      data: { ok: true },
      email: { to: recruiter.email, subject: "coverage", body: "ok" },
    });
    const previous = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@getstrata/applicationContext")
    ];
    setActiveApplicationContext({
      container: {
        resolve() {
          throw new Error("no queue");
        },
      },
    } as never);
    try {
      await notifyUser({ userId: recruiter.id, type: "coverage-fallback", data: { ok: true } });
    } finally {
      if (previous) {
        setActiveApplicationContext(previous as never);
      }
    }
  });

  test("lib helpers, catalogs, audit, and hiring event failures stay covered", async () => {
    expect(roleName(ROLE.ADMIN)).toBe("admin");
    expect(roleName(ROLE.RECRUITER)).toBe("recruiter");
    expect(roleName(ROLE.CANDIDATE)).toBe("candidate");
    expect(roleName("1")).toBe("admin");
    expect(isAdmin(ROLE.ADMIN)).toBe(true);
    expect(isRecruiter(ROLE.RECRUITER)).toBe(true);
    expect(isCandidate(ROLE.CANDIDATE)).toBe(true);
    expect(isStaff(ROLE.ADMIN)).toBe(true);
    expect(isStaff(ROLE.CANDIDATE)).toBe(false);

    const admin = await seededUser("admin@hiroapp.com");
    expect(toSessionUser(admin).is_admin).toBe(true);
    const recruiter = await seededUser("recruiter@hiroapp.com");
    const session = toSessionUser(recruiter);
    expect(session.email).toBe(recruiter.email);
    expect(session.is_admin).toBe(false);

    const qr = otpauthQrDataUri("otpauth://totp/HiroApp:recruiter@hiroapp.com?secret=ABC");
    expect(qr.startsWith("data:image/svg+xml")).toBe(true);

    expect((await skills.ordered()).length).toBeGreaterThan(0);
    expect(await skills.findByName("missing-skill-xyz")).toBeNull();
    expect(Array.isArray(await comments.findAll({ limit: 1 }))).toBe(true);
    expect(Array.isArray(await notifications.findAll({ limit: 1 }))).toBe(true);
    expect(Array.isArray(await auditService.listRecent(1))).toBe(true);
    await billingService.getSubscriptionForTenant(1);

    const originalDispatch = webhookService.dispatch.bind(webhookService);
    webhookService.dispatch = async () => {
      throw new Error("subscriber down");
    };
    try {
      await recordHiringEvent(
        "application.submitted",
        { department_id: 1 },
        { type: "application", id: 1 },
      );
    } finally {
      webhookService.dispatch = originalDispatch;
    }
  });
});
