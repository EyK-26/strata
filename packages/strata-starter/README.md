# @getstrata/starter

The application generator for [Strata](https://github.com/EyK-26/strata/blob/main/README.md). Requires Bun >=1.4.4; tested on Bun 1.4.4.

Use the short package name:

```bash
bunx create-strata my-app
```

This scoped package provides the same generator and also works directly:

```bash
bunx @getstrata/starter my-app
```

The wizard selects a frontend, database, authentication, tenancy, cache, queue, mail, and optional integrations. For unattended generation:

```bash
bunx @getstrata/starter my-app --yes --frontend=server-htmx --database=sqlite --auth=cookie --no-docker
```

Use `--help` for supported flags. A target can be a project name or directory path. Existing output paths are refused, including with `--force`.

Generated apps contain model classes in `src/models`, named controllers in `src/http/controllers`, and explicit browser/API routes in `src/routes/web.ts` and `src/routes/api.ts`. Application configuration lives in `src/config/app.ts` and `src/bootstrap/createApp.ts`. Selected features determine the authentication routes, views, migrations, and integrations included.

Follow the generated README to configure the environment, start selected services, install dependencies, migrate, and run the app. Choices are recorded in `strata.layers.json`; the generated file inventory is in `.strata/generator.json`.

See the [project README](https://github.com/EyK-26/strata/blob/main/README.md), [starter and layer options](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md), [authentication](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [integrations](https://github.com/EyK-26/strata/blob/main/docs/INTEGRATIONS.md), and [production](https://github.com/EyK-26/strata/blob/main/docs/PRODUCTION.md).

Generated apps include an `AGENTS.md` tailored to their selected stack, with application feature workflows and validation guidance for AI coding agents.
