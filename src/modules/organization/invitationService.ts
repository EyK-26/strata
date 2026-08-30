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

type ReceivedInvitationResource = OrganizationInvitationResource & {
  organization: { id: number; name: string; slug: string } | null;
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

function invitationExpired(expiresAt: Date | string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

function buildInvitationAcceptUrl(email: string, token: string): string {
  return absoluteTemporarySignedUrl(
    "/invitations/accept",
    resolveInvitationTtlSeconds(),
    { email, token },
    appConfig.url,
  );
}

async function sendInvitationMail(input: {
  email: string;
  role: OrganizationMemberRole;
  organizationName: string;
  acceptUrl: string;
}): Promise<void> {
  const appName = appDisplayName();
  await sendMarkdownMail(mailer(), {
    to: input.email,
    subject: `Join ${input.organizationName} on ${appName}`,
    markdown: `# You are invited to ${input.organizationName}

Accept this signed invitation to join as **${input.role}**. The link expires in 7 days.

[Accept invitation](${input.acceptUrl})

If you do not have an account yet, register with **${input.email}** and this invitation is applied automatically.`,
    layout: { title: `Join ${input.organizationName}`, footer: appName },
  });
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
    const acceptUrl = buildInvitationAcceptUrl(email, token);
    await sendInvitationMail({
      email,
      role,
      organizationName: organization.name,
      acceptUrl,
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

  async resend(organizationId: number, invitationId: number): Promise<InviteResult> {
    const invitation = await this.invitations.findByIdAndOrganizationOrThrow(
      organizationId,
      invitationId,
    );

    if (invitationExpired(invitation.expires_at)) {
      await this.invitations.deleteById(invitation.id);
      throw new ValidationError("This invitation has expired.", {
        token: ["This invitation has expired."],
      });
    }

    const organization = await this.organizations.findById(organizationId);

    if (!organization) {
      throw new NotFoundError(`Organization ${organizationId} not found.`);
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + resolveInvitationTtlSeconds() * 1000);
    const updated = await this.invitations.refreshToken(
      invitation.id,
      hashApiToken(token),
      expiresAt,
    );
    const acceptUrl = buildInvitationAcceptUrl(updated.email, token);
    await sendInvitationMail({
      email: updated.email,
      role: updated.role,
      organizationName: organization.name,
      acceptUrl,
    });

    logSecurityEvent("organization_invitation_resent", {
      organization_id: organizationId,
      invitation_id: invitationId,
      email: updated.email,
    });

    return {
      invitation: toInvitationResource(updated),
      token,
      acceptUrl,
    };
  }

  async listPending(organizationId: number): Promise<OrganizationInvitationResource[]> {
    const rows = await this.keepUnexpired(
      await this.invitations.listPendingForOrganization(organizationId),
    );
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

    if (invitationExpired(invitation.expires_at)) {
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
      if (invitationExpired(invitation.expires_at)) {
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

  async listPendingForUser(user: Pick<UserRecord, "email">): Promise<ReceivedInvitationResource[]> {
    const pending = await this.keepUnexpired(
      await this.invitations.listPendingByEmail(normalizeEmail(user.email)),
    );
    const received: ReceivedInvitationResource[] = [];

    for (const invitation of pending) {
      const organization = await this.organizations.findById(invitation.organization_id);
      received.push({
        ...toInvitationResource(invitation),
        organization: organization
          ? { id: organization.id, name: organization.name, slug: organization.slug }
          : null,
      });
    }

    return received;
  }

  async acceptForUser(
    invitationId: number,
    user: Pick<UserRecord, "id" | "email">,
  ): Promise<OrganizationMemberRecord> {
    const invitation = await this.requirePendingForUser(invitationId, user);
    const membership = await this.addIfMissing(invitation, user.id);
    await this.invitations.deleteById(invitation.id);
    await this.switchCurrentOrganization(user.id, invitation.organization_id);
    logSecurityEvent("organization_invitation_accepted", {
      organization_id: invitation.organization_id,
      user_id: user.id,
    });

    return membership;
  }

  async declineForUser(
    invitationId: number,
    user: Pick<UserRecord, "id" | "email">,
  ): Promise<void> {
    const invitation = await this.requirePendingForUser(invitationId, user);
    await this.invitations.deleteById(invitation.id);
    logSecurityEvent("organization_invitation_declined", {
      organization_id: invitation.organization_id,
      user_id: user.id,
      invitation_id: invitation.id,
    });
  }

  private async requirePendingForUser(
    invitationId: number,
    user: Pick<UserRecord, "id" | "email">,
  ): Promise<OrganizationInvitationRecord> {
    const pending = await this.invitations.listPendingByEmail(normalizeEmail(user.email));
    const invitation = pending.find((row) => row.id === invitationId);

    if (!invitation) {
      throw new NotFoundError(`Organization invitation ${invitationId} not found.`);
    }

    if (invitationExpired(invitation.expires_at)) {
      await this.invitations.deleteById(invitation.id);
      throw new ValidationError("This invitation has expired.", {
        token: ["This invitation has expired."],
      });
    }

    return invitation;
  }

  private async keepUnexpired(
    rows: OrganizationInvitationRecord[],
  ): Promise<OrganizationInvitationRecord[]> {
    const pending: OrganizationInvitationRecord[] = [];

    for (const invitation of rows) {
      if (invitationExpired(invitation.expires_at)) {
        await this.invitations.deleteById(invitation.id);
        continue;
      }

      pending.push(invitation);
    }

    return pending;
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

export type { InviteResult, OrganizationInvitationResource, ReceivedInvitationResource };
export {
  OrganizationInvitationService,
  organizationInvitationServiceToken,
  parseInvitationRole,
  resolveInvitationService,
  resolveInvitationTtlSeconds,
  toInvitationResource,
};
