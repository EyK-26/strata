# Framework contributor setup

For a product app, run `bunx create-strata` and follow its generated README. Product dogfood is [strata-shop](https://github.com/EyK-26/strata-shop); this checkout maintains framework packages and tests.

## Requirements

Install the Bun version in `.bun-version` and Docker with Compose. The framework requires Bun >=1.4.3. Contributor infrastructure uses Postgres, MySQL and Redis; generated Docker acceptance additionally starts an owned temporary Postgres container.

```bash
bun install
docker compose up -d postgres mysql redis --wait
bun run validate:host
```

The host wrapper configures local published ports. Override its database/Redis variables when required; migration credentials are administrative, while generated HTTP tests inspect a restricted live role. The existing `hiroapp_test` database name is retained as a local compatibility default, not an app or schema dependency. Generated acceptance owns disposable databases.

## Focused validation

```bash
scripts/with-host-env.sh bun run verify:generated-runtime
scripts/with-host-env.sh bun test tests/e2e/generatedDocker.test.ts
scripts/with-host-env.sh env STRATA_SCHEMA=fixture bun run cli migrate:status
```

The private root CLI operates on `src/db` framework fixtures only. Its migration/reset/seed commands require `STRATA_SCHEMA=fixture` and reject production/staging (including `NODE_ENV=production`) before database access. Test-reset database-name guards remain in test setup. Do not use it to manage an external product app.

All runtime routes and API-only OpenAPI contracts run through generated apps using candidate packages. The CLI command/SDK unit tests use a small deterministic fixture map; it is deliberately separate from the committed 22-operation generated-app acceptance document and 40-operation runtime inventory.

The root Dockerfile packages a generated candidate app, not checked-in HiroApp. Its required native Bun acceptance test exercises explicit migrations, production seeding refusal, explicit test-only seeding, restricted-role HTTP, metrics concealment and graceful shutdown. See [testing](TESTING.md) and [retirement evidence](GENERATED-APP-ACCEPTANCE.md).

The tracked legacy app directories and their regeneration command are retired. To explore a storefront or admin UI, use the external shop.
