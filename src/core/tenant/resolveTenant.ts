import type { DatabaseSession, TransactionSession } from "../database/session";
import type { TenantContext } from "./tenantContext";
export async function resolveTenant(
  selected: DatabaseSession | TransactionSession,
  tenantId: number,
): Promise<TenantContext | null> {
  const q = selected.dialect.quoteIdentifier.bind(selected.dialect);
  const rows = await selected.execute<{ id: number; slug: string }>({
    text: `SELECT ${q("id")}, ${q("slug")} FROM ${q("tenant")} WHERE ${q("id")} = ${selected.dialect.placeholder(1)}`,
    params: [tenantId],
  });
  const row = rows[0];
  return row ? { id: row.id, slug: row.slug } : null;
}
