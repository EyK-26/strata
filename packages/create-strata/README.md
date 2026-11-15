# create-strata

Create a Laravel-inspired Bun and TypeScript application with [Strata](https://github.com/EyK-26/strata/blob/main/README.md). Requires Bun >=1.4.4; tested on Bun 1.4.4.

```bash
bunx create-strata@latest my-app
```

The wizard asks for each layer. Use `--yes` with flags for unattended generation:

```bash
bunx create-strata@latest my-app --yes --frontend=server-htmx --database=sqlite --auth=cookie --no-docker
```

A target can be a project name or directory path. Existing output paths are refused.

| Layer | Choices |
| --- | --- |
| Frontend | `api`, `server-htmx`, `spa-react`, `hybrid` |
| Database | `sqlite`, `postgres`, `mysql` |
| Authentication | `headers`, `cookie`, `token`, `jwt`, `cookie-token`, `cookie-token-jwt` |
| Tenancy | `none`, `column`, `rls` (PostgreSQL) |
| Cache | `array`, `redis` |
| Queue | `sync`, `redis` |
| Mail | `log`, `smtp` |

Optional features include MFA, email verification, SCIM, metrics, OAuth, billing, and webhooks. Availability depends on the selected layers. Docker Compose is optional; Adminer is an explicit selection. Run `bunx create-strata@latest --help` for flags and defaults.

For the SQLite example above:

```bash
cd my-app
cp .env.example .env
bun install
bun run db:migrate
bun run dev
```

Other choices may need database services or a frontend build; follow the generated README. Apps use model classes in `src/models`, named actions in `src/http/controllers`, and route declarations in `src/routes/web.ts` and `src/routes/api.ts`.

The generated package.json includes the application-local `strata` CLI; `bun install` installs it. Run the generated `bun run` scripts or `bunx strata <command>` from inside the app directory.

`create-strata` and [`@getstrata/starter`](https://www.npmjs.com/package/@getstrata/starter) provide the same generator.

See the [project README](https://github.com/EyK-26/strata/blob/main/README.md), [starter guide](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md), [authentication guide](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), and [integration guide](https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md).

Generated apps include an `AGENTS.md` tailored to their selected stack, with application feature workflows and validation guidance for AI coding agents.
