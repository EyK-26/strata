# create-strata changelog

## 3.1.2

- Align both generator package descriptions with Laravel-inspired Bun and TypeScript development. Use `@latest` consistently in quick starts, CLI help and scaffolded documentation. Clarify that `bun install` installs the generated application CLI dependency.
- Generate application dependencies targeting the coordinated 3.1.2 release; application runtime behavior is unchanged.

## 3.1.1

- Generate an application-specific AGENTS.md with the selected stack, conventional feature workflow, public API guidance, access-control rules and available commands. Link it from the generated README; framework contributor instructions are not copied into apps.

## 3.1.0

- Generate class models with one typed field declaration and no mandatory repository exports.
- Move selected HTTP handlers into named controllers and application routes into `src/routes/api.ts` and `web.ts`. Controllers receive concrete dependencies; route composition resolves services at startup. Preserve account workflows, middleware, SSO state binding and tenant isolation.
- Align generated guidance and scaffolding with Laravel 13 conventions using native Bun/TypeScript execution. Existing generated apps are not rewritten by a package upgrade; see the application workflow guide in docs/BUILDING-APPS.md.

## 3.0.8

Synchronize packages and correct installed starter template discovery. Both generator entrypoints include their selected templates in published packages.
