import { BaseRepository } from "../database/baseRepository";
import { defineTable } from "../database/table";
import { isTenancyEnabled } from "./tenancyConfig";
import type { TenantContext } from "./tenantContext";

const tenants = new BaseRepository(
  defineTable<{ id: number; slug: string }, "id">({
    name: "tenant",
    primaryKey: "id",
    columns: ["id", "slug"],
  }),
);

async function resolveTenant(tenantId: number): Promise<TenantContext | null> {
  if (!isTenancyEnabled()) {
    return {
      id: tenantId,
      slug: "default",
    };
  }

  const row = await tenants.findById(tenantId);
  return row ? { id: row.id, slug: row.slug } : null;
}

export { resolveTenant };
