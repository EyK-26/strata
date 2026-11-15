# @getstrata/bootstrap

Application startup, HTTP route composition, service configuration, and resource cleanup for [Strata](https://github.com/EyK-26/strata/blob/main/README.md). Requires Bun >=1.4.4; tested on Bun 1.4.4.

The generator configures this package for you:

```bash
bunx create-strata my-app
```

For an existing application:

```bash
bun add @getstrata/bootstrap @getstrata/core
```

`defineApp` from `@getstrata/bootstrap/application` takes the application definition and returns `bootstrapApp`, `createApp`, and `createAppServer`. Generated apps keep that definition in `src/bootstrap/createApp.ts`; their HTTP entry point is:

```typescript
import { serveApplication } from "@getstrata/bootstrap/application";
import { createAppServer } from "./createApp.ts";

await serveApplication(createAppServer);
```

Application paths and middleware belong in `src/routes/web.ts` and `src/routes/api.ts`. Named actions live in `src/http/controllers`; constructors receive concrete capabilities, while each action receives Bun's native `Request` and its execution ports. `BusinessRouteHandler` is exported from `@getstrata/bootstrap/persistenceContracts`, and `ModuleRouteContext` from `@getstrata/bootstrap/contracts` describes route composition.

The HTTP kernel provides API and browser middleware groups, including authentication, CSRF, and throttling. Keep those declarations on the route when assigning a controller action. Optional modules can contribute routes through the same composition API. Testing helpers live on `@getstrata/bootstrap/testing`.

See the [project README](https://github.com/EyK-26/strata/blob/main/README.md), [starter guide](https://github.com/EyK-26/strata/blob/main/docs/STARTER.md), [authentication guide](https://github.com/EyK-26/strata/blob/main/docs/AUTH.md), and [production guide](https://github.com/EyK-26/strata/blob/main/docs/PRODUCTION.md).
