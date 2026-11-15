# Laravel-shaped application authoring

## Reference and scope

Reviewed against Laravel **13.x**, with framework release **v13.42.0** current on
2026-11-15. The official documentation site was inaccessible from the execution
environment; the review used the official `laravel/docs` 13.x sources:

- [Directory structure](https://github.com/laravel/docs/blob/13.x/structure.md)
- [Controllers](https://github.com/laravel/docs/blob/13.x/controllers.md)
- [Routing](https://github.com/laravel/docs/blob/13.x/routing.md)
- [Eloquent models](https://github.com/laravel/docs/blob/13.x/eloquent.md)
- [Relationships](https://github.com/laravel/docs/blob/13.x/eloquent-relationships.md)
- [Form requests](https://github.com/laravel/docs/blob/13.x/validation.md)
- [Authorization](https://github.com/laravel/docs/blob/13.x/authorization.md)
- [Container scopes](https://github.com/laravel/docs/blob/13.x/container.md)
- [Providers](https://github.com/laravel/docs/blob/13.x/providers.md)
- [Long-lived workers](https://github.com/laravel/docs/blob/13.x/octane.md)

The objective is familiar navigation and ordinary application authoring, not PHP
syntax emulation or implementing every Laravel subsystem. Retain working framework
capabilities and their ownership guarantees. Do not add mandatory forwarding
services, repositories, decorators, runtime type reflection or schema introspection.

## Decisions

| Surface | Application contract | Internal constraint |
| --- | --- | --- |
| Models | Named classes with instance methods and relationship methods | Classes describe models; no class stores a selected connection, tenant or transaction |
| Fields | One typed field declaration; infer the record type and runtime column list | TypeScript erases interfaces, so explicit runtime metadata remains necessary |
| Tables | Inline table name, `id` default, optional key/order overrides | Migrations remain authoritative for actual database DDL; declarations do not run migrations |
| Repositories | Optional custom data-access extension | Derive ordinary repositories from registered classes inside each application |
| Queries | `database.model(Note)` and `transaction.model(Note)` | Scope expiry, rollback, tenant policy and pool ownership remain enforced |
| Relationships | Methods such as `category() { return this.belongsTo(Category, "category_id"); }` | Related classes must be registered; resolve within the owner's session |
| Controllers | Named files under `src/http/controllers`; selected controllers only | Plain TypeScript classes and native Request/Response; no mandatory base class |
| Routes | `src/routes/api.ts` and `web.ts`, composed at bootstrap | Preserve existing middleware ordering, collision detection and Bun route-map execution |
| Requests | `src/http/requests` for application form-request classes | Validation and authorization remain explicit; request body parsing honors Content-Type |
| Policies | `src/policies` | Authentication, abilities and resource/tenant policy remain distinct checks |
| Modules | Optional domain grouping, with the same class/controller conventions | Do not require a module wrapper for every ordinary controller |
| Services/providers | Add services for actual reusable behavior; provider setup/boot remain phased | Explicit typed dependencies replace PHP runtime reflection; application and execution lifetimes stay separate |
| Events/cache | Model-targeted effects with automatic default repository binding | Preserve after-commit publication and cache invalidation; rollback publishes nothing |
| CLI | Consistent make:model/controller/request/policy scaffolds | Validate paths, preserve existing files, and avoid implicit schema/route mutations |
| Jobs/listeners | Existing named classes/declarations and owned dispatch | Long-lived workers do not retain a request database or identity in a singleton |
| Views/storage/mail | Existing selected views and native streaming/storage adapters | Controllers return responses; do not add implicit view guessing or buffer streaming bodies |
| Tests | Authoring and installed-package acceptance | Source-only checks cannot prove npm package identity, metadata or template layout |

Laravel's controller documentation explicitly permits controllers without a base
class. Its scoped-container and Octane guidance also warns against retaining stale
requests or containers in long-lived singletons. Strata therefore follows the
development structure while retaining explicit execution capabilities for Bun's
long-lived process.

## Authoring example

```ts
import { defineModel, field } from "@getstrata/core/database/model";
import { Category } from "./Category";

export class Note extends defineModel({
  table: "notes",
  fields: {
    id: field.number(),
    body: field.string(),
    category_id: field.number(),
    created_at: field.timestamp(),
  },
}) {
  static $fillable = ["body", "category_id"] as const;
  static $timestamps = false;

  category() {
    return this.belongsTo(Category, "category_id");
  }
}
```

Register `Note` and `Category` in the application's model list. A schema migration
creates their tables and foreign key. If a row type is needed, use
`ModelAttributes<Note>` rather than repeating an interface and columns array.
Use `field.nullable(...)` for nullable attributes. Field metadata describes driver
values; it does not validate incoming HTTP bodies. Boolean values can be booleans
or numeric driver values, and timestamps can be Date objects or strings. Casts are
an explicit model choice.

Within an owned execution:

```ts
await database.transaction(async transaction => {
  const note = await transaction.model(Note).findOrFail(1);
  const category = await note.category().first();
  await note.update({ body: "Reviewed" });
});
```

No `NoteRepository`, constructor callback, dependency array, independent table
object or mutable global registration is required for this ordinary model. Existing
low-level definition APIs remain available for custom dependencies and repositories.

## Performance constraints

- Compile class metadata during application registry construction; query paths use
  application-owned lookup maps and the existing SQL execution pipeline.
- Assemble route maps and middleware at startup. Do not scan files, reflect on
  controller methods or parse generated source per request.
- Retain native Bun HTTP and database paths and existing lazy optional drivers.
  No new automatic database introspection or startup queries are introduced.
- Generate only selected frontend/auth/integration files. Avoid pass-through
  service layers that allocate objects without adding behavior.
- Do not claim a throughput improvement without measurements. The acceptance
  target is unchanged execution semantics and no additional metadata/database work
  in the query path; application performance still requires representative workloads.

## Verification required before completion

1. Class field inference rejects unknown/wrongly typed writes and missing keys;
   inherited methods survive hydration, relation queries, rebinding and transactions.
2. Two applications using the same class have independent registries and sessions;
   changing a class after registration cannot change an existing application's metadata.
3. Transactions, nested rollback, after-commit effects, scope expiry and tenant
   policy continue through the existing persistence boundary.
4. Class-only registration retains model-write cache invalidation, with no
   invalidation after rollback and no early invalidation before commit.
5. Generated controller/route separation preserves authentication, CSRF, MFA,
   SSO state binding, response modes, optional features and route collision checks.
6. Source type checks and installed tarball checks both exercise the new public
   APIs, including shared ORM class identity and the optional MySQL loader boundary.
7. Scaffolding produces navigable files with safe names and no unrequested overwrites;
   documentation and templates teach the same structure.

This ledger records the implementation contract. Actual validation outcomes and
remaining limitations belong in the pull request; this document alone is not a
claim that the checks have passed.
