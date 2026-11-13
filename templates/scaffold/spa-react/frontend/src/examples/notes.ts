/** Displayed source only; business handlers execute after the developer adds this module. */
export function notesModuleExample(tenancy: boolean): string {
  const scope = tenancy ? ".where({ tenant_id: ports.established.tenant.id })" : "";
  return `// src/modules/notes/index.ts
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { Note } from "../../models/Note.ts";

export default {
  name: "notes",
  routes({ kernel }) {
    return {
      "/api/v1/notes": {
        GET: kernel.wrapApi(async (_request, ports) => {
          const rows = await ports.database.model(Note).query()${scope}.orderBy({ column: "id", direction: "DESC" }).limit(100).get();
          return jsonResponse({ data: rows.map(row => row.toObject()) });
        }),
      },
    };
  },
} satisfies AppModule;`;
}
