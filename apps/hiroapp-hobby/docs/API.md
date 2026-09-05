# API-only scaffold

This template enables `FRONTEND_MODE=api`.

- JSON API routes under `/api/v1/*`
- No server-rendered views or SPA assets
- Use bearer tokens or dev auth headers in tests (`actingAs`, `postJson`)

Run `bun run cli new --template=api` to copy this note and set the env flag.
