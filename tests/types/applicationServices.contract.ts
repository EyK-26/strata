/** Compiled in source and clean packed consumers; this function is never executed. */

import { createServiceToken as bootstrapToken } from "@getstrata/bootstrap/contracts";
import { createServiceToken as rootToken } from "@getstrata/core";
import {
  configEnum,
  configInteger,
  parseApplicationConfig,
} from "@getstrata/core/config/applicationConfig";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import {
  aliasService,
  resourceService,
  type ServiceDeclaration,
  service,
  valueService,
} from "@getstrata/core/contracts/services";
import { createServiceToken, type ServiceToken } from "@getstrata/core/contracts/token";
import {
  type CommandScope,
  createApplication,
  type OpenOutcome,
  type ResourceSpec,
} from "@getstrata/core/runtime/application";

interface Settings {
  port: number;
  driver: "array" | "redis";
  nested: { flags: boolean[] };
}

export function applicationServiceContracts(scope: CommandScope): void {
  const N = createServiceToken<number>("number");
  const S = createServiceToken<string>("string");
  const engine = new ServiceContainer();
  // @ts-expect-error Assembly aliases must retain the same invariant service type too.
  engine.alias(N, S);
  const settings = parseApplicationConfig(
    { PORT: { required: true }, OPTIONAL: {} },
    { PORT: "42" },
    (env) => {
      const required: string = env.PORT;
      const optional: string | undefined = env.OPTIONAL;
      void optional;
      // @ts-expect-error An optional validated setting is not guaranteed present.
      const missing: string = env.OPTIONAL;
      void missing;
      const config: Settings = {
        port: configInteger("PORT", required),
        driver: configEnum("DRIVER", "array", ["array", "redis"]),
        nested: { flags: [true] },
      };
      return config;
    },
  );
  const Settings = createServiceToken<typeof settings>("settings");
  const A = createServiceToken<number>("alias");
  const managedSpec: ResourceSpec<number> = {
    name: "typed managed",
    open(signal): OpenOutcome<number> {
      const cancelled: boolean = signal.aborted;
      void cancelled;
      return { ok: true, value: 1 };
    },
    close(value, context) {
      const payload: number = value;
      const signal: AbortSignal = context.signal;
      void [payload, signal];
      // @ts-expect-error Resource close receives the token payload, never a different type.
      const wrong: string = value;
      void wrong;
    },
  };
  const managed = resourceService(N, {
    lifetime: "application",
    dependencies: [S, Settings],
    create(text, config) {
      const typed: string = text;
      const port: number = config.port;
      void [typed, port];
      return managedSpec;
    },
  });
  const declarations = [
    valueService(Settings, settings),
    valueService(N, 1),
    valueService(S, "s"),
    service(A, {
      lifetime: "application",
      dependencies: [N, S, Settings],
      create: async (n, s, config) => n + s.length + config.port,
    }),
  ];
  const app = createApplication({
    providers: [],
    services: declarations,
    overrides: [valueService(N, 2)],
  });
  const count: number = scope.resolve(rootToken<number>("root"));
  const text: string = scope.resolve(bootstrapToken<string>("bootstrap"));
  void [app, count, text, managed, aliasService(A, N)];
  // @ts-expect-error Typed values cannot be widened to satisfy a wrong payload.
  valueService(N, "wrong");
  // @ts-expect-error Alias targets must have the same invariant service type.
  aliasService(N, S);
  // @ts-expect-error No legacy string resolver exists on application callbacks.
  scope.resolve<number>("legacy");
  // @ts-expect-error Explicit generics cannot bypass an invariant token.
  scope.resolve<string>(N);
  // @ts-expect-error Tokens remain invariant across covariance temptation.
  const widened: ServiceToken<string | number> = S;
  void widened;
  // @ts-expect-error Parsed settings are deeply readonly.
  settings.nested.flags.push(false);
  // @ts-expect-error Enum helpers preserve their exact union.
  const wrongDriver: "other" = settings.driver;
  void wrongDriver;
  // @ts-expect-error A validated input mapping is mandatory; ambient defaults are forbidden.
  parseApplicationConfig({}, () => ({}));
  resourceService(N, {
    lifetime: "execution",
    dependencies: [S, Settings],
    create(text, config) {
      const typed: string = text;
      const port: number = config.port;
      void [typed, port];
      return managedSpec;
    },
  });
  resourceService(N, {
    // @ts-expect-error Resource lifetimes remain limited to application and execution.
    lifetime: "task",
    dependencies: [],
    create: () => managedSpec,
  });
  resourceService(N, {
    lifetime: "application",
    dependencies: [],
    // @ts-expect-error Descriptor construction is synchronous; open owns async work.
    create: async () => managedSpec,
  });
  resourceService(N, {
    lifetime: "application",
    dependencies: [],
    // @ts-expect-error Managed open outcomes must match the invariant token payload.
    create: () => ({ name: "wrong", open: () => ({ ok: true, value: "wrong" }), close() {} }),
  });
  resourceService(N, {
    lifetime: "application",
    dependencies: [S],
    // @ts-expect-error Managed descriptor factories receive their declared dependency tuple.
    create: (value: number) => {
      void value;
      return managedSpec;
    },
  });
  // @ts-expect-error Erased managed declarations require the original private helper brand.
  const rawResource: ServiceDeclaration = {
    kind: "resource",
    token: N,
    lifetime: "application",
    dependencies: [],
    create: () => managedSpec,
  };
  void rawResource;
  const promise = createServiceToken<Promise<number>>("promise");
  // @ts-expect-error Managed resources cannot publish Promise payloads.
  resourceService(promise, {
    lifetime: "application",
    dependencies: [],
    create: () => ({
      name: "forbidden payload",
      open: () => ({ ok: true, value: scope.resolve(promise) }),
      close() {},
    }),
  });
  // @ts-expect-error A Promise is not a supported service payload.
  valueService(promise, Promise.resolve(1));
  // @ts-expect-error Async initialization must produce a non-Promise payload T.
  service(promise, { lifetime: "application", dependencies: [], create: () => Promise.resolve(1) });
  const union = createServiceToken<number | Promise<number>>("union");
  // @ts-expect-error Managed resources also reject union payloads concealing Promises.
  resourceService(union, {
    lifetime: "application",
    dependencies: [],
    create: () => ({
      name: "forbidden payload",
      open: () => ({ ok: true, value: scope.resolve(union) }),
      close() {},
    }),
  });
  // @ts-expect-error Union payloads cannot conceal Promise-valued services.
  valueService(union, 1);
  const callable = createServiceToken<{ then(resolve: (n: number) => void): void }>("callable");
  // @ts-expect-error Callable-then payloads are assimilable even without PromiseLike's full signature.
  valueService(callable, {
    // biome-ignore lint/suspicious/noThenProperty: This negative type fixture intentionally declares a thenable.
    then(resolve) {
      resolve(1);
    },
  });
  // @ts-expect-error Managed payloads cannot introduce callable-then assimilation.
  resourceService(callable, {
    lifetime: "application",
    dependencies: [],
    create: () => ({
      name: "forbidden payload",
      open: () => ({ ok: true, value: scope.resolve(callable) }),
      close() {},
    }),
  });
  // @ts-expect-error Callable-then tokens cannot enter through alias helpers either.
  aliasService(callable, callable);
  const optionalThen = createServiceToken<{ then?: (resolve: (n: number) => void) => void }>(
    "optional then",
  );
  // @ts-expect-error Optional callable then still permits native assimilation.
  valueService(optionalThen, {});
  // @ts-expect-error Optional-then payload types are not application value factory payloads.
  service(optionalThen, { lifetime: "application", dependencies: [], create: () => ({}) });
  // @ts-expect-error Aliasing cannot reintroduce optional callable-then payloads.
  aliasService(optionalThen, optionalThen);
  const unionThen = createServiceToken<{ then: string | ((resolve: (n: number) => void) => void) }>(
    "union then",
  );
  // biome-ignore lint/suspicious/noThenProperty: Noncallable then data is deliberately supported.
  const ordinary = { then: "text" };
  // @ts-expect-error A union-valued then may be callable despite a particular string value.
  valueService(unionThen, ordinary);
  // @ts-expect-error Factory token payload cannot conceal callable-then union members.
  service(unionThen, {
    lifetime: "application",
    dependencies: [],
    create: () => ordinary,
  });
  // @ts-expect-error Aliases retain the callable-then union restriction.
  aliasService(unionThen, unionThen);
  const textThen = createServiceToken<{ then: string }>("data then");
  valueService(textThen, ordinary);
  service(textThen, { lifetime: "application", dependencies: [], create: () => ordinary });
  service(N, {
    lifetime: "application",
    dependencies: [],
    // @ts-expect-error Factory output is checked against the token's service type.
    create: () => "bad",
  });
  service(N, {
    lifetime: "application",
    dependencies: [S],
    // @ts-expect-error Dependency arguments come from the declared tuple, not user annotations.
    create: (value: number) => value,
  });
  // @ts-expect-error Erased value declarations require the private typed-helper brand.
  const rawValue: ServiceDeclaration = {
    kind: "value",
    token: N,
    lifetime: "application",
    value: "wrong",
  };
  // @ts-expect-error Raw factories cannot bypass their number token through the erased declaration union.
  const rawFactory: ServiceDeclaration = {
    kind: "factory",
    token: N,
    lifetime: "application",
    dependencies: [],
    create: () => "wrong",
  };
  // @ts-expect-error Raw aliases cannot connect invariant number/string tokens.
  const rawAlias: ServiceDeclaration = { kind: "alias", token: N, target: S };
  void [rawValue, rawFactory, rawAlias];
  createApplication({
    providers: [],
    services: [
      // @ts-expect-error Application services accept helper-issued declarations, not unbranded raw records.
      { kind: "value", token: N, lifetime: "application", value: "wrong" },
    ],
  });
}
