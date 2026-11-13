import { resourceService, type ServiceDeclaration } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { DATABASE_MANAGER_TOKEN } from "@getstrata/core/database/tokens";
import { assertRlsLiveDatabaseRole } from "./secretsGuard";
/** Declared app graph dependency keeps awaited native probes before transport admission. */
export function createDatabaseReadinessBindings(
  connection: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly ServiceDeclaration[] {
  const snapshot = Object.freeze({ ...env });
  const ready = createServiceToken<boolean>("database.readiness");
  return Object.freeze([
    resourceService(ready, {
      lifetime: "application",
      dependencies: [DATABASE_MANAGER_TOKEN] as const,
      create: (manager) => ({
        name: "database.readiness",
        async open() {
          try {
            const pool = manager.connection(connection);
            await pool.execute({ text: "SELECT 1", params: [] });
            await assertRlsLiveDatabaseRole({ ...snapshot }, async () => {
              const rows = await pool.execute<{
                rolname: string;
                rolsuper: boolean;
                rolbypassrls: boolean;
              }>({
                text: "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
                params: [],
              });
              return rows[0] ?? null;
            });
            return { ok: true as const, value: true };
          } catch (error) {
            // This probe acquired no independent native resource; the borrowed pool
            // remains registered in its original canonical resource declaration.
            return { ok: false as const, error, disposition: "not-acquired" as const };
          }
        },
        close: () => undefined,
      }),
    }),
  ]);
}
