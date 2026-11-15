# @getstrata/cli

The application-local `strata` command for [Strata](https://github.com/EyK-26/strata/blob/main/README.md): development servers, migrations, scaffolding, workers, OpenAPI, and scheduling. Requires Bun >=1.4.4; tested on Bun 1.4.4.

Generated applications include the CLI. To install it in an existing Strata app:

```bash
bun add @getstrata/cli
```

Run commands from the application directory:

```bash
bunx strata help
bunx strata dev
bunx strata migrate
bunx strata make:model Task
bunx strata make:controller Task
bunx strata make:request StoreTask
bunx strata make:migration create_tasks
```

Generated apps also supply scripts such as `bun run dev` and `bun run db:migrate`. The binary is installed locally; use these scripts or `bunx strata` inside the app.

Scaffolding creates model classes in `src/models`, controllers in `src/http/controllers`, and requests in `src/http/requests`. Add the model to `src/models/register.ts` and register controller actions in `src/routes/web.ts` or `src/routes/api.ts`. Migrations remain explicit. Use `bunx strata make:model --help` for table and primary-key options.

`strata.config.ts` selects application, server, schedule, migration, and custom-command entry points. Custom commands come from `src/cli/register.ts`. `queue:work` and `outbox:work` run separately from HTTP. In production, apply migrations explicitly before starting the application.

To create a whole application, use `bunx create-strata my-app`.

See the [project README](https://github.com/EyK-26/strata/blob/main/README.md), [starter guide](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md), [queue guide](https://github.com/EyK-26/strata/blob/main/docs/QUEUES.md), [initial-admin provisioning](https://github.com/EyK-26/strata/blob/main/docs/INITIAL-ADMIN.md), and [production guide](https://github.com/EyK-26/strata/blob/main/docs/PRODUCTION.md).
