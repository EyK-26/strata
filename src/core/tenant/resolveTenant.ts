import { repositoryConnection as db } from "../database/repositoryConnection";
import type { TenantContext } from "./tenantContext";

async function resolveTenant(tenantId: number): Promise<TenantContext | null> {
  const rows = (await db`
    SELECT id, slug, plan, region
    FROM tenant
    WHERE id = ${tenantId}
    LIMIT 1
  `) as Array<{
    id: number;
    slug: string;
    plan: TenantContext["plan"];
    region: TenantContext["region"];
  }>;

  const row = rows[0];
  return row ? { id: row.id, slug: row.slug, plan: row.plan, region: row.region ?? "eu" } : null;
}

export { resolveTenant };
