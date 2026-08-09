# API-only scaffold

This template enables `FRONTEND_MODE=api`.

- JSON API routes under `/api/v1/*`
- No server-rendered views or SPA assets
- Use bearer tokens or dev auth headers in tests (`actingAs`, `postJson`)

Generate an API app with `bunx create-strata my-app --frontend api --yes`.
