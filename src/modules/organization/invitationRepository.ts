import { NotFoundError } from "@getstrata/core/errors/http";
import db from "../../db/connection";
import type { OrganizationMemberRole } from "./memberTypes";

type OrganizationInvitationRecord = {
  id: number;
  organization_id: number;
  email: string;
  role: OrganizationMemberRole;
  invited_by: number;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
};

class OrganizationInvitationRepository {
  constructor() {}

  async create(input: {
    organizationId: number;
    email: string;
    role: OrganizationMemberRole;
    invitedBy: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<OrganizationInvitationRecord> {
    const rows = (await db`
      INSERT INTO organization_invitation (
        organization_id, email, role, invited_by, token_hash, expires_at
      )
      VALUES (
        ${input.organizationId},
        ${input.email},
        ${input.role},
        ${input.invitedBy},
        ${input.tokenHash},
        ${input.expiresAt}
      )
      RETURNING id, organization_id, email, role, invited_by, token_hash, expires_at, created_at
    `) as OrganizationInvitationRecord[];

    const row = rows[0];

    if (!row) {
      throw new Error("Organization invitation insert did not return a row.");
    }

    return row;
  }

  async findById(id: number): Promise<OrganizationInvitationRecord | null> {
    const rows = (await db`
      SELECT id, organization_id, email, role, invited_by, token_hash, expires_at, created_at
      FROM organization_invitation
      WHERE id = ${id}
      LIMIT 1
    `) as OrganizationInvitationRecord[];

    return rows[0] ?? null;
  }

  async findPendingByOrganizationAndEmail(
    organizationId: number,
    email: string,
  ): Promise<OrganizationInvitationRecord | null> {
    const rows = (await db`
      SELECT id, organization_id, email, role, invited_by, token_hash, expires_at, created_at
      FROM organization_invitation
      WHERE organization_id = ${organizationId} AND email = ${email}
      LIMIT 1
    `) as OrganizationInvitationRecord[];

    return rows[0] ?? null;
  }

  async listPendingForOrganization(
    organizationId: number,
  ): Promise<OrganizationInvitationRecord[]> {
    return (await db`
      SELECT id, organization_id, email, role, invited_by, token_hash, expires_at, created_at
      FROM organization_invitation
      WHERE organization_id = ${organizationId}
      ORDER BY id
    `) as OrganizationInvitationRecord[];
  }

  async listPendingByEmail(email: string): Promise<OrganizationInvitationRecord[]> {
    return (await db`
      SELECT id, organization_id, email, role, invited_by, token_hash, expires_at, created_at
      FROM organization_invitation
      WHERE email = ${email}
      ORDER BY id
    `) as OrganizationInvitationRecord[];
  }

  async deleteById(id: number): Promise<boolean> {
    const rows = (await db`
      DELETE FROM organization_invitation
      WHERE id = ${id}
      RETURNING id
    `) as Array<{ id: number }>;

    return rows.length > 0;
  }

  async deleteByOrganizationAndEmail(organizationId: number, email: string): Promise<boolean> {
    const rows = (await db`
      DELETE FROM organization_invitation
      WHERE organization_id = ${organizationId} AND email = ${email}
      RETURNING id
    `) as Array<{ id: number }>;

    return rows.length > 0;
  }

  async deleteByIdAndOrganization(organizationId: number, id: number): Promise<boolean> {
    const rows = (await db`
      DELETE FROM organization_invitation
      WHERE organization_id = ${organizationId} AND id = ${id}
      RETURNING id
    `) as Array<{ id: number }>;

    return rows.length > 0;
  }

  async findByIdAndOrganizationOrThrow(
    organizationId: number,
    id: number,
  ): Promise<OrganizationInvitationRecord> {
    const rows = (await db`
      SELECT id, organization_id, email, role, invited_by, token_hash, expires_at, created_at
      FROM organization_invitation
      WHERE organization_id = ${organizationId} AND id = ${id}
      LIMIT 1
    `) as OrganizationInvitationRecord[];
    const row = rows[0];

    if (!row) {
      throw new NotFoundError(`Organization invitation ${id} not found.`);
    }

    return row;
  }
}

export type { OrganizationInvitationRecord };
export default OrganizationInvitationRepository;
