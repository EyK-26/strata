# @getstrata/cli changelog

## 3.1.5

Coordinate the CLI dependency pins with the corrected core class-model type declarations in 3.1.5. CLI runtime behavior is unchanged.

## 3.1.4

- Synchronize package versions and dependency pins at 3.1.4 for the corrected starter release validation. No additional runtime changes in this package.

## 3.1.3

- Generate class-based model listeners instead of missing repository imports; reject missing models before writing files.
- Avoid duplicate Job suffixes, emit the required static override, and point model registration guidance at the generated app registry.
- Reject automatic CRUD modules that would ignore selected tenancy or require disabled views before writing files.

## 3.1.2

- Describe application servers, scaffolding, migrations, workers and scheduling in npm metadata. Align peer dependencies with 3.1.2.

## 3.1.1

- Align core/bootstrap peer ranges with 3.1.1 so generated applications use the coordinated package set.

## 3.1.0

- Generate concise model classes and infer factory/record types without table, interface or repository companion files.
- Add `make:controller`; align requests and policies with `src/http/requests` and `src/policies`. Optional domain modules emit named controllers and retain secured CRUD, cache and route-model-binding behavior.

## 3.0.8

Synchronize packages and correct installed starter template discovery. Both generator entrypoints include their selected templates in published packages.
