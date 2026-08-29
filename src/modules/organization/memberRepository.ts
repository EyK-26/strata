import { NotFoundError } from "@getstrata/core/errors/http";
import db from "../../db/connection";
import type { OrganizationMemberRecord, OrganizationMemberRole } from "./memberTypes";

class OrganizationMemberRepository {
  constructor() {}

  async findMembership(
    userId: number,
    organizationId: number,
  ): Promise<OrganizationMemberRecord | null> {
    const rows = (await db`
      SELECT id, organization_id, user_id, role, created_at
      FROM organization_member
      WHERE user_id = ${userId} AND organization_id = ${organizationId}
      LIMIT 1
    `) as OrganizationMemberRecord[];

    return rows[0] ?? null;
  }

  async listForUser(userId: number): Promise<OrganizationMemberRecord[]> {
    return (await db`
      SELECT id, organization_id, user_id, role, created_at
      FROM organization_member
      WHERE user_id = ${userId}
      ORDER BY organization_id
    `) as OrganizationMemberRecord[];
  }

  async listForOrganization(organizationId: number): Promise<OrganizationMemberRecord[]> {
    return (await db`
      SELECT id, organization_id, user_id, role, created_at
      FROM organization_member
      WHERE organization_id = ${organizationId}
      ORDER BY id
    `) as OrganizationMemberRecord[];
  }

  async addMember(input: {
    organizationId: number;
    userId: number;
    role?: OrganizationMemberRole;
  }): Promise<OrganizationMemberRecord> {
    const rows = (await db`
      INSERT INTO organization_member (organization_id, user_id, role)
      VALUES (${input.organizationId}, ${input.userId}, ${input.role ?? "member"})
      RETURNING id, organization_id, user_id, role, created_at
    `) as OrganizationMemberRecord[];

    const row = rows[0];

    if (!row) {
      throw new Error("Organization member insert did not return a row.");
    }

    return row;
  }

  async updateMemberRole(
    organizationId: number,
    userId: number,
    role: OrganizationMemberRole,
  ): Promise<OrganizationMemberRecord> {
    const rows = (await db`
      UPDATE organization_member
      SET role = ${role}
      WHERE organization_id = ${organizationId} AND user_id = ${userId}
      RETURNING id, organization_id, user_id, role, created_at
    `) as OrganizationMemberRecord[];

    const row = rows[0];

    if (!row) {
      throw new NotFoundError(`Organization member ${userId} not found.`);
    }

    return row;
  }

  async removeMember(organizationId: number, userId: number): Promise<boolean> {
    const rows = (await db`
      DELETE FROM organization_member
      WHERE organization_id = ${organizationId} AND user_id = ${userId}
      RETURNING id
    `) as Array<{ id: number }>;

    return rows.length > 0;
  }
}

export default OrganizationMemberRepository;
