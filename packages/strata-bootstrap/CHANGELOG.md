# @getstrata/bootstrap changelog

## 3.1.9

Fix graceful shutdown during the first SQL outbox poll.

## 3.1.8

Fix graceful shutdown for admitted outbox completions

## 3.1.7

Fix graceful shutdown for admitted queue jobs

## 3.1.6

fix: drain admitted request bookkeeping during shutdown

## 3.1.5

Coordinate with the corrected core class-model type declarations in 3.1.5. Bootstrap runtime behavior is unchanged.

## 3.1.4

- Synchronize package versions and dependency pins at 3.1.4 for the corrected starter release validation. No additional runtime changes in this package.

## 3.1.3

- Accept class models directly in `defineModelListener` while preserving explicit repository listeners and after-commit behavior.

## 3.1.2

- Describe application startup, routing, middleware and service configuration in npm metadata. Align the core peer dependency with 3.1.2.

## 3.1.1

- Synchronize the package version and core peer range for the 3.1.1 application-agent guide release.

## 3.1.0

- Preserve API/web classification when composing unclassified route maps, preventing generated browser pages from leaking into API-only OpenAPI output.
- Allow applications to register model classes without manual repository declarations; preserve after-commit cache invalidation for their derived repositories.
- Expose startup route composition for conventional application route files while retaining middleware, collision detection, tenant boundaries and native Bun responses.

## 3.0.8

Synchronize packages and correct installed starter template discovery. Both generator entrypoints include their selected templates in published packages.
