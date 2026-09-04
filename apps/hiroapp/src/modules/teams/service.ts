import { randomBytes } from "node:crypto";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { ForbiddenError, NotFoundError, ValidationError } from "@getstrata/core/errors/http";
import { mailer } from "@getstrata/core/mail/mailer";
import { sendMarkdownMail } from "@getstrata/core/mail/markdownMailable";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";
import { isAdmin, isCandidate, isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { canManageTeam, requireStaffDepartmentAccess } from "../../lib/staffTeam.ts";
import { departments } from "../departments/repository.ts";
import { type UserRecord, users } from "../users/repository.ts";
import { departmentInvitations } from "./invitationRepository.ts";
import { departmentMembers } from "./memberRepository.ts";
import type { TeamRole } from "./memberTable.ts";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseRole(role: string | undefined): TeamRole {
  const resolved = role ?? "member";
  if (resolved !== "owner" && resolved !== "member") {
    throw new ValidationError("The given data was invalid.", {
      role: ["role must be owner or member."],
    });
  }
  return resolved;
}

export class TeamService {
  async listMembers(actor: UserRecord, departmentId: number) {
    await requireStaffDepartmentAccess(actor, departmentId);
    const rows = await departmentMembers.forDepartment(departmentId);
    return Promise.all(
      rows.map(async (row) => {
        const user = await users.findById(row.user_id);
        return {
          id: Number(row.id),
          department_id: Number(row.department_id),
          user_id: Number(row.user_id),
          role: row.role,
          user: user
            ? {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                role_id: user.role_id,
              }
            : null,
        };
      }),
    );
  }

  async addMember(actor: UserRecord, departmentId: number, userId: number, role?: string) {
    await requireStaffDepartmentAccess(actor, departmentId);
    if (!(await canManageTeam(actor, departmentId))) {
      throw new ForbiddenError("Only team owners can add members.");
    }
    const user = await users.findByIdOrThrow(userId);
    if (!isStaff(user.role_id)) {
      throw new ValidationError("The given data was invalid.", {
        user_id: ["Candidates cannot join a hiring team."],
      });
    }
    const existing = await departmentMembers.findMembership(departmentId, userId);
    if (existing) {
      return existing;
    }
    const created = await departmentMembers.create({
      department_id: departmentId,
      user_id: userId,
      role: parseRole(role),
      created_at: new Date(),
    });
    if (!user.current_department_id) {
      await users.updateById(userId, { current_department_id: departmentId });
    }
    logSecurityEvent("team_member_added", { department_id: departmentId, user_id: userId });
    return created;
  }

  async removeMember(actor: UserRecord, departmentId: number, userId: number) {
    await requireStaffDepartmentAccess(actor, departmentId);
    if (!(await canManageTeam(actor, departmentId))) {
      throw new ForbiddenError("Only team owners can remove members.");
    }
    const membership = await departmentMembers.findMembership(departmentId, userId);
    if (!membership) {
      throw new NotFoundError("Membership not found.");
    }
    await departmentMembers.deleteById(membership.id);
    const target = await users.findById(userId);
    if (target && Number(target.current_department_id) === departmentId) {
      const remaining = await departmentMembers.forUser(userId);
      await users.updateById(userId, {
        current_department_id: remaining[0] ? Number(remaining[0].department_id) : null,
      });
    }
  }

  async invite(actor: UserRecord, departmentId: number, email: string, role?: string) {
    await requireStaffDepartmentAccess(actor, departmentId);
    if (!(await canManageTeam(actor, departmentId))) {
      throw new ForbiddenError("Only team owners can invite members.");
    }
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new ValidationError("The given data was invalid.", {
        email: ["The email field is required."],
      });
    }
    const existingUser = await users.findByEmail(normalized);
    if (existingUser && isCandidate(existingUser.role_id)) {
      throw new ValidationError("The given data was invalid.", {
        email: ["Candidates cannot be invited onto a hiring team."],
      });
    }
    if (existingUser && (await departmentMembers.findMembership(departmentId, existingUser.id))) {
      throw new ValidationError("The given data was invalid.", {
        email: ["That person is already on this hiring team."],
      });
    }
    const open = await departmentInvitations.findOpen(departmentId, normalized);
    if (open) {
      await departmentInvitations.deleteById(open.id);
    }
    const token = randomBytes(32).toString("hex");
    const invitation = await departmentInvitations.create({
      department_id: departmentId,
      email: normalized,
      role: parseRole(role),
      invited_by: actor.id,
      token_hash: hashApiToken(token),
      expires_at: new Date(Date.now() + INVITATION_TTL_MS),
      created_at: new Date(),
    });
    const department = await departments.findByIdOrThrow(departmentId);
    await sendMarkdownMail(mailer(), {
      to: normalized,
      subject: `Join ${department.name} on HiroApp`,
      markdown: `You are invited to the **${department.name}** hiring team as **${invitation.role}**. Sign in and accept the invitation from Account.`,
    });
    logSecurityEvent("team_invitation_created", {
      department_id: departmentId,
      email: normalized,
    });
    await recordHiringEvent(
      "team.invited",
      { department_id: departmentId, email: normalized, role: invitation.role },
      { type: "department_invitation", id: Number(invitation.id) },
    );
    return {
      invitation: {
        id: Number(invitation.id),
        department_id: Number(invitation.department_id),
        email: invitation.email,
        role: invitation.role,
        invited_by: Number(invitation.invited_by),
        expires_at: iso(invitation.expires_at),
        created_at: iso(invitation.created_at),
      },
      token,
    };
  }

  async listInvitations(actor: UserRecord, departmentId: number) {
    await requireStaffDepartmentAccess(actor, departmentId);
    const rows = await departmentInvitations.forDepartment(departmentId);
    return rows.map((row) => ({
      id: Number(row.id),
      department_id: Number(row.department_id),
      email: row.email,
      role: row.role,
      invited_by: Number(row.invited_by),
      expires_at: iso(row.expires_at),
      created_at: iso(row.created_at),
    }));
  }

  async receivedInvitations(user: UserRecord) {
    const rows = await departmentInvitations.forEmail(user.email);
    return Promise.all(
      rows.map(async (row) => {
        const department = await departments.findById(row.department_id);
        return {
          id: Number(row.id),
          department_id: Number(row.department_id),
          email: row.email,
          role: row.role,
          expires_at: iso(row.expires_at),
          department: department ? { id: department.id, name: department.name } : null,
        };
      }),
    );
  }

  async acceptInvitation(user: UserRecord, invitationId: number) {
    if (!isStaff(user.role_id)) {
      throw new ForbiddenError("Staff only.");
    }
    const invitation = await departmentInvitations.findById(invitationId);
    if (!invitation || invitation.email !== user.email.toLowerCase()) {
      throw new NotFoundError("Invitation not found.");
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      throw new ValidationError("The given data was invalid.", {
        invitation: ["This invitation has expired."],
      });
    }
    const existing = await departmentMembers.findMembership(
      Number(invitation.department_id),
      user.id,
    );
    if (!existing) {
      await departmentMembers.create({
        department_id: Number(invitation.department_id),
        user_id: user.id,
        role: invitation.role,
        created_at: new Date(),
      });
    }
    await users.updateById(user.id, {
      current_department_id: Number(invitation.department_id),
    });
    await departmentInvitations.deleteById(invitation.id);
    return departmentMembers.findMembership(Number(invitation.department_id), user.id);
  }

  async declineInvitation(user: UserRecord, invitationId: number) {
    const invitation = await departmentInvitations.findById(invitationId);
    if (!invitation || invitation.email !== user.email.toLowerCase()) {
      throw new NotFoundError("Invitation not found.");
    }
    await departmentInvitations.deleteById(invitation.id);
  }

  async switchCurrentDepartment(user: UserRecord, departmentId: number) {
    await requireStaffDepartmentAccess(user, departmentId);
    if (
      !isAdmin(user.role_id) &&
      !(await departmentMembers.findMembership(departmentId, user.id))
    ) {
      throw new ForbiddenError("You are not a member of this hiring team.");
    }
    return users.updateByIdOrThrow(user.id, { current_department_id: departmentId });
  }
}

export const teamService = new TeamService();
