# @getstrata/core

Database models, HTTP utilities, authentication, queues, mail, storage, and security for [Strata](https://github.com/EyK-26/strata/blob/main/README.md) applications. Requires Bun >=1.4.4; tested on Bun 1.4.4.

Start an application with the generator:

```bash
bunx create-strata@latest my-app
```

To add the runtime library to an existing project:

```bash
bun add @getstrata/core
```

Use focused public subpaths. Ordinary models extend `defineModel`; fields supply both runtime metadata and inferred attribute types:

```typescript
import { defineModel, field } from "@getstrata/core/database/model";

export class Note extends defineModel({
  table: "notes",
  fields: { id: field.number(), body: field.string() },
}) {
  static $fillable = ["body"] as const;
  static $timestamps = false;
}
```

Register the class with the application, then query through the current execution's `database.model(Note)`. Inside a transaction, use its supplied database session. Schema changes belong in migrations.

Other public APIs include `FormRequest` from `@getstrata/core/http/formRequest`, `Policy` from `@getstrata/core/auth/policy`, and response helpers from `@getstrata/core/http/response`. Testing controls live on `@getstrata/core/testing`.

See the [project README](https://github.com/EyK-26/strata/blob/main/README.md) and the guides for [databases](https://github.com/EyK-26/strata/blob/main/docs/DATABASE.md), [authentication](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), [tenancy](https://github.com/EyK-26/strata/blob/main/docs/TENANCY.md), [queues](https://github.com/EyK-26/strata/blob/main/docs/QUEUES.md), [storage](https://github.com/EyK-26/strata/blob/main/docs/STORAGE.md), and [media](https://github.com/EyK-26/strata/blob/main/docs/MEDIA.md).
