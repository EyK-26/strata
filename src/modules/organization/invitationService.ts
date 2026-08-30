import { randomBytes } from "node:crypto";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import { normalizeEmail } from "@getstrata/core/crypto/fieldEncryption";
import { NotFoundError, ValidationError } from "@getstrata/core/errors/http";
import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { mailer } from "@getstrata/core/mail/mailer";
import { sendMarkdownMail } from "@getstrata/core/mail/markdownMailable";
import { appDisplayName } from "@getstrata/core/runtime/appKeyPrefix";
import { resolveApplicationDependencies } from "@getstrata/core/runtime/applicationRegistry";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { timingSafeCompareString } from "@getstrata/core/security/timingSafeCompare";
import { emailRule, required, stringRule, validateObject } from "@getstrata/core/validation/rules";
import { appConfig } from "../../config/app";
import { CurrentOrganizationService } from "../user/currentOrganizationService";
import UserRepository from "../user/repository";
import type { UserRecord } from "../user/types";
import OrganizationInvitationRepository, {
  type OrganizationInvitationRecord,
} from "./invitationRepository";
import OrganizationMemberRepository from "./memberRepository";
import type { OrganizationMemberRecord, OrganizationMemberRole } from "./memberTypes";
import OrganizationRepository from "./repository";

const DEFAULT_INVITATION_TTL_SECONDS = 60 * 60 * 24 * 7;
const organizationInvitationServiceToken = "organization.invitationService";

type OrganizationInvitationResource = {
  id: number;
  organization_id: number;
  email: string;
  role: OrganizationMemberRole;
  invited_by: number;
  expires_at: string;
  created_at: string;
};

type InviteResult = {
  invitation: OrganizationInvitationResource;
  token: string;
  acceptUrl: string;
};

function resolveInvitationTtlSeconds(): number {
  const raw = Number(process.env.ORGANIZATION_INVITATION_TTL_SECONDS ?? "");

  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }

  return DEFAULT_INVITATION_TTL_SECONDS;
}

function parseInvitationRole(role: string | undefined): OrganizationMemberRole {
  const resolved = role ?? "member";

  if (resolved !== "owner" && resolved !== "admin" && resolved !== "member") {
    throw new ValidationError("role must be owner, admin, or member.", {
      role: ["role must be owner, admin, or member."],
    });
  }

  return resolved;
}

function toInvitationResource(
  record: OrganizationInvitationRecord,
): OrganizationInvitationResource {
  return {
    id: record.id,
    organization_id: record.organization_id,
    email: record.email,
    role: record.role,
    invited_by: record.invited_by,
    expires_at: new Date(record.expires_at).toISOString(),
    created_at: new Date(record.created_at).toISOString(),
  };
}

class OrganizationInvitationService {
  constructor(
    private readonly invitations: OrganizationInvitationRepository,
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
    private readonly members: OrganizationMemberRepository = new OrganizationMemberRepository(),
  ) {}

  async invite(input: {
    organizationId: number;
    email: string;
    role?: string;
    invitedByUserId: number;
  }): Promise<InviteResult> {
    const validated = validateObject(
      { email: input.email },
      { email: [required(), stringRule(), emailRule()] },
    );
    const email = normalizeEmail(String(validated.email));
    const role = parseInvitationRole(input.role);
    const organization = await this.organizations.findById(input.organizationId);

    if (!organization) {
      throw new NotFoundError(`Organization ${input.organizationId} not found.`);
    }

    const existingUser = await this.users.findByEmail(email);

    if (existingUser) {
      const membership = await this.members.findMembership(existingUser.id, input.organizationId);

      if (membership) {
        throw new ValidationError("That user is already a member.", {
          email: ["That user is already a member."],
        });
      }
    }

    await this.invitations.deleteByOrganizationAndEmail(input.organizationId, email);

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + resolveInvitationTtlSeconds() * 1000);
    const invitation = await this.invitations.create({
      organizationId: input.organizationId,
      email,
      role,
      invitedBy: input.invitedByUserId,
      tokenHash: hashApiToken(token),
      expiresAt,
    });
    const acceptUrl = absoluteTemporarySignedUrl(
      "/invitations/accept",
      resolveInvitationTtlSeconds(),
      { email, token },
      appConfig.url,
    );

    const appName = appDisplayName();
    await sendMarkdownMail(mailer(), {
      to: email,
      subject: `Join ${organization.name} on ${appName}`,
      markdown: `# You are invited to ${organization.name}

Accept this signed invitation to join as **${role}**. The link expires in 7 days.

[Accept invitation](${acceptUrl})

If you do not have an account yet, register with **${email}** and this invitation is applied automatically.`,
      layout: { title: `Join ${organization.name}`, footer: appName },
    });

    logSecurityEvent("organization_invitation_sent", {
      organization_id: input.organizationId,
      invited_by: input.invitedByUserId,
      email,
    });

    return {
      invitation: toInvitationResource(invitation),
      token,
      acceptUrl,
    };
  }

  async listPending(organizationId: number): Promise<OrganizationInvitationResource[]> {
    const rows = await this.invitations.listPendingForOrganization(organizationId);
    return rows.map(toInvitationResource);
  }

  async cancel(organizationId: number, invitationId: number): Promise<void> {
    const deleted = await this.invitations.deleteByIdAndOrganization(organizationId, invitationId);

    if (!deleted) {
      throw new NotFoundError(`Organization invitation ${invitationId} not found.`);
    }

    logSecurityEvent("organization_invitation_cancelled", {
      organization_id: organizationId,
      invitation_id: invitationId,
    });
  }

  async accept(
    email: string,
    token: string,
    user: Pick<UserRecord, "id" | "email">,
  ): Promise<OrganizationMemberRecord> {
    const normalized = normalizeEmail(email);

    if (normalizeEmail(user.email) !== normalized) {
      throw new ValidationError("This invitation is for another email address.", {
        email: ["This invitation is for another email address."],
      });
    }

    const pending = await this.invitations.listPendingByEmail(normalized);
    const invitation = pending.find((row) =>
      timingSafeCompareString(row.token_hash, hashApiToken(token)),
    );

    if (!invitation) {
      throw new ValidationError("This invitation is invalid.", {
        token: ["This invitation is invalid."],
      });
    }

    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      await this.invitations.deleteById(invitation.id);
      throw new ValidationError("This invitation has expired.", {
        token: ["This invitation has expired."],
      });
    }

    const membership = await this.addIfMissing(invitation, user.id);
    await this.invitations.deleteById(invitation.id);
    await this.switchCurrentOrganization(user.id, invitation.organization_id);
    logSecurityEvent("organization_invitation_accepted", {
      organization_id: invitation.organization_id,
      user_id: user.id,
    });

    return membership;
  }

  async acceptPendingForUser(user: Pick<UserRecord, "id" | "email">): Promise<number> {
    const pending = await this.invitations.listPendingByEmail(normalizeEmail(user.email));
    let accepted = 0;
    let currentOrganizationId: number | undefined;

    for (const invitation of pending) {
      if (new Date(invitation.expires_at).getTime() <= Date.now()) {
        await this.invitations.deleteById(invitation.id);
        continue;
      }

      await this.addIfMissing(invitation, user.id);
      await this.invitations.deleteById(invitation.id);
      currentOrganizationId = invitation.organization_id;
      accepted += 1;
    }

    if (accepted > 0 && currentOrganizationId !== undefined) {
      await this.switchCurrentOrganization(user.id, currentOrganizationId);
      logSecurityEvent("organization_invitation_auto_accepted", {
        user_id: user.id,
        count: accepted,
      });
    }

    return accepted;
  }

  private async addIfMissing(
    invitation: OrganizationInvitationRecord,
    userId: number,
  ): Promise<OrganizationMemberRecord> {
    const existing = await this.members.findMembership(userId, invitation.organization_id);

    if (existing) {
      return existing;
    }

    return await this.members.addMember({
      organizationId: invitation.organization_id,
      userId,
      role: invitation.role,
    });
  }

  private async switchCurrentOrganization(userId: number, organizationId: number): Promise<void> {
    await new CurrentOrganizationService(this.users, this.organizations).assign(
      userId,
      organizationId,
    );
  }
}

function resolveInvitationService(): OrganizationInvitationService {
  try {
    const dependencies = resolveApplicationDependencies();

    if (dependencies.container.has(organizationInvitationServiceToken)) {
      return dependencies.container.resolve<OrganizationInvitationService>(
        organizationInvitationServiceToken,
      );
    }
  } catch {
    // Tests and early boot construct the service directly.
  }

  return new OrganizationInvitationService(
    new OrganizationInvitationRepository(),
    new UserRepository(),
    new OrganizationRepository(),
  );
}

export type { InviteResult, OrganizationInvitationResource };
export {
  OrganizationInvitationService,
  organizationInvitationServiceToken,
  parseInvitationRole,
  resolveInvitationService,
  resolveInvitationTtlSeconds,
  toInvitationResource,
};
