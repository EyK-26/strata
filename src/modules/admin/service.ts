import { featureFlags } from "../../config/features";
import db from "../../db/connection";

interface AdminStats {
  user_count: number;
  organization_count: number;
  project_count: number;
  task_count: number;
  tenant_count: number;
}

interface TenantSummary {
  id: number;
  name: string;
  slug: string;
  plan: string;
  organization_count: number;
}

interface OrganizationMemberSummary {
  id: number;
  organization_id: number;
  user_id: number;
  role: string;
  created_at: string;
}

class AdminService {
  async stats(): Promise<AdminStats> {
    const [users, organizations, projects, tasks, tenants] = await Promise.all([
      db`SELECT COUNT(*)::int AS count FROM users`,
      db`SELECT COUNT(*)::int AS count FROM organization WHERE deleted_at IS NULL`,
      db`SELECT COUNT(*)::int AS count FROM project WHERE deleted_at IS NULL`,
      db`SELECT COUNT(*)::int AS count FROM task WHERE deleted_at IS NULL`,
      db`SELECT COUNT(*)::int AS count FROM tenant`,
    ]);

    return {
      user_count: (users[0] as { count: number }).count,
      organization_count: (organizations[0] as { count: number }).count,
      project_count: (projects[0] as { count: number }).count,
      task_count: (tasks[0] as { count: number }).count,
      tenant_count: (tenants[0] as { count: number }).count,
    };
  }

  async listTenants(): Promise<TenantSummary[]> {
    const rows = (await db`
      SELECT
        t.id,
        t.name,
        t.slug,
        t.plan,
        COUNT(o.id)::int AS organization_count
      FROM tenant t
      LEFT JOIN organization o ON o.tenant_id = t.id AND o.deleted_at IS NULL
      GROUP BY t.id, t.name, t.slug, t.plan
      ORDER BY t.id
    `) as Array<{
      id: number;
      name: string;
      slug: string;
      plan: string;
      organization_count: number;
    }>;

    return rows;
  }

  async listOrganizationMembers(limit = 100): Promise<OrganizationMemberSummary[]> {
    const rows = (await db`
      SELECT id, organization_id, user_id, role, created_at
      FROM organization_member
      ORDER BY id
      LIMIT ${limit}
    `) as Array<{
      id: number;
      organization_id: number;
      user_id: number;
      role: string;
      created_at: Date;
    }>;

    return rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    }));
  }

  featureFlags(): typeof featureFlags {
    return featureFlags;
  }
}

export default AdminService;
export type { AdminStats, OrganizationMemberSummary, TenantSummary };
