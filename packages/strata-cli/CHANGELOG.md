# @getstrata/cli changelog

## 3.1.2

- Describe application servers, scaffolding, migrations, workers and scheduling in npm metadata. Align peer dependencies with 3.1.2.

## 3.1.1

- Align core/bootstrap peer ranges with 3.1.1 so generated applications use the coordinated package set.

## 3.1.0

- Generate concise model classes and infer factory/record types without table, interface or repository companion files.
- Add `make:controller`; align requests and policies with `src/http/requests` and `src/policies`. Optional domain modules emit named controllers and retain secured CRUD, cache and route-model-binding behavior.

## 3.0.8

Synchronize packages and correct installed starter template discovery. Both generator entrypoints include their selected templates in published packages.
