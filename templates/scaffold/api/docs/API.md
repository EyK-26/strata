# API-only scaffold

This scaffold sets `FRONTEND_MODE=api`: no server-rendered views beyond the welcome page, and no SPA assets.

## What exists after migrating

- `GET /health` returns plain text `ok`, or `degraded` when the database ping fails.
- `GET /` returns the welcome page.
- A `notes` table, with no routes on it yet.

Login endpoints depend on the auth layer you chose. Token auth adds `POST /api/v1/auth/login` and `GET /api/v1/auth/me`; JWT auth adds `POST /api/auth/token`; header auth adds none and expects `x-authenticated-user-id` for local work only.

There is no CRUD endpoint for `notes`. Adding your own routes is the first thing you do.

## Adding a route

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

## Generating an app instead

```bash
bunx create-strata my-app --frontend api --yes
```

A generated app writes its own `docs/API.md` listing only the routes its layers actually serve.
