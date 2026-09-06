# hiroapp-hobby API

`FRONTEND_MODE=api`. No server-rendered views beyond the welcome page and no SPA assets.

## Routes this app serves today

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Plain text `ok` (200), or `degraded` (503) until the database ping succeeds and the migrated `notes` table exists. Docker HEALTHCHECK uses this path. |
| `GET` | `/` | Welcome page. Restyle or replace it. |

There is no CRUD endpoint for the seeded `notes` table. Adding your own routes is the first thing you do.

## Auth

Auth is `headers`. Send `x-authenticated-user-id` (and optional `x-authenticated-user-role`) for local work and tests. There are no login endpoints and no `users` table. Production must set `AUTH_DEV_HEADERS=false`, which turns those headers off and leaves you without a guard, so pick another auth layer before you ship.

## Adding a route

Create a module under `src/modules/` and return a route map. Modules are discovered on boot.

```typescript
// src/modules/notes/index.ts
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { getSql } from "../../bootstrap/database.ts";

const notesModule: AppModule = {
  name: "notes",
  order: 2,
  routes({ kernel }) {
    return {
      "/api/v1/notes": kernel.wrap("api", async () => {
        const rows = await getSql().unsafe<{ id: number; body: string }>(
          "SELECT id, body FROM notes ORDER BY id DESC",
        );
        return jsonResponse({ data: rows });
      }),
    };
  },
};

export default notesModule;
```

Import from `@getstrata/core/...` subpaths rather than the package root, so singleton state such as the database pool stays shared.

## Docs

- [Building apps](https://github.com/EyK-26/strata/blob/main/docs/BUILDING-APPS.md)
- [Auth choices](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md)
- [Databases](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md)
