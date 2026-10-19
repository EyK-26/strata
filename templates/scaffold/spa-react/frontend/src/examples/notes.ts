/** Displayed source only; business handlers execute after the developer adds this module. */
export function notesModuleExample(tenancy: boolean): string {
  const tenantImport = tenancy
    ? 'import { currentTenantId } from "@getstrata/core/tenant/tenantContext";\n'
    : "";
  const scope = tenancy ? ".where({ tenant_id: currentTenantId() })" : "";
  return `// src/modules/notes/index.ts
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
${tenantImport}import { Note } from "../../models/Note.ts";

export default {
  name: "notes",
  routes({ kernel }) {
    return {
      "/api/v1/notes": {
        GET: kernel.wrapApi(async () => {
          const rows = await Note.query()${scope}.orderBy({ column: "id", direction: "DESC" }).limit(100).get();
          return jsonResponse({ data: rows.map(row => row.toObject()) });
        }),
      },
    };
  },
} satisfies AppModule;`;
}
