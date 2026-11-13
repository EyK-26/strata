import { test } from "bun:test";
import assert from "node:assert/strict";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createApplication } from "@getstrata/core/runtime/application";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import {
  CORE_ABILITY_CHECKER_TOKEN,
  CORE_CONFIG_TOKEN,
  CORE_POLICY_GATE_TOKEN,
  REDIS_URL_CONFIG_KEY,
} from "../../src/bootstrap/config";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";
import { HTTP_PERSISTENCE_OPTIONS } from "../../src/bootstrap/httpPersistence";
import {
  dispatchOwnedRoute,
  identityModes,
  ownedHttpRoute,
  ownedPublicHttpRoute,
  scimMiddleware,
} from "../../src/bootstrap/ownedHttpRoute";
import type {
  BusinessRequestPorts,
  HttpPersistenceOptions,
} from "../../src/bootstrap/persistenceContracts";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";

const message = "HTTP route handler must be a function.";
const isHandlerError = (error: unknown) => error instanceof TypeError && error.message === message;

async function fixture() {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  const counts = { service: 0, config: 0, invoke: 0, metadata: 0, option: 0, property: 0 };
  class ObservedConfig extends ConfigStore {
    override get<T>(key: string): T | undefined {
      counts.config++;
      return super.get<T>(key);
    }
  }
  const config = new ObservedConfig();
  config.set(REDIS_URL_CONFIG_KEY, "");
  const original = new ServiceContainer();
  original.set(CORE_CONFIG_TOKEN, config);
  original.set(CORE_POLICY_GATE_TOKEN, new PolicyGate());
  original.set(CORE_ABILITY_CHECKER_TOKEN, { tokenCan: () => true, requireAbility: () => {} });
  const http: HttpPersistenceOptions = {
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    features: { viewsEnabled: false, publicReadsEnabled: true, emailVerificationRequired: false },
    passwordConfirmation: {
      cookieName: "boundary_confirm",
      secret: "boundary-fixture-secret",
      ttlSeconds: 300,
    },
    signatureSecret: "boundary-fixture-secret",
    metadata: () => {
      counts.metadata++;
      return {
        authenticate: async () => ({ status: "absent", user: null, credentialSource: null }),
        memberships: async () => [],
        userTenantId: async () => 1,
        tenant: async () => null,
      };
    },
  };
  original.set(HTTP_PERSISTENCE_OPTIONS, http);
  const container = new Proxy(original, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (
        typeof value === "function" &&
        ["has", "get", "resolve", "make"].includes(String(property))
      )
        return (...args: unknown[]) => {
          counts.service++;
          return Reflect.apply(value, target, args);
        };
      return value;
    },
  });
  const canonical = createPersistenceInvocation(app, "main");
  const kernel = createHttpKernel({
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    storage: new StorageManager(createStorageDriver({ driver: "local", rootDirectory: "storage" })),
    invoke: (envelope, work) => {
      counts.invoke++;
      return canonical(envelope, work);
    },
  });
  Object.keys(counts).forEach((key) => {
    counts[key as keyof typeof counts] = 0;
  });
  return {
    kernel,
    counts,
    async close() {
      kernel.dispose();
      assert.equal((await app.stop()).successful, true);
    },
  };
}

test("real kernel rejects original malformed handlers before configuration, service, throttle or guest-wrapper effects", async () => {
  const { kernel, counts, close } = await fixture();
  const invalidProxy = new Proxy(
    {},
    {
      get() {
        counts.property++;
        throw new Error("Must not read malformed handler properties");
      },
      getOwnPropertyDescriptor() {
        counts.property++;
        throw new Error("Must not inspect malformed handler metadata");
      },
    },
  );
  const options = {
    get allowAnonymous() {
      counts.option++;
      return true;
    },
  };
  // Representative entry families, not every wrapper/value combination.
  const attempts: Array<[string, () => unknown]> = [
    ["run", () => kernel.run(new Request("http://example.test"), null as never)],
    ["composed explicit metadata", () => kernel.composed(undefined as never, "json", [], [])],
    [
      "public document",
      () => kernel.wrapPublicDocument(new Response("invalid direct response") as never),
    ],
    ["group throttle allocation", () => kernel.wrap("api", 7 as never)],
    ["password configuration", () => kernel.wrapPasswordConfirm({} as never)],
    ["web password configuration", () => kernel.wrapWebPasswordConfirm(null as never)],
    ["ability service", () => kernel.wrapAbility("notes.view", invalidProxy as never)],
    ["web ability service", () => kernel.wrapWebAbility("notes.view", undefined as never)],
    ["policy service", () => kernel.wrapPolicy("notes", "view", new Response("invalid") as never)],
    ["login throttle", () => kernel.wrapLogin(0 as never)],
    ["register throttle", () => kernel.wrapRegister({} as never)],
    ["signature configuration", () => kernel.wrapSigned(null as never)],
    ["guest closure", () => kernel.wrapWebGuest(invalidProxy as never)],
    ["public-read option", () => kernel.wrapPublicRead(undefined as never, options)],
    ["web public-read option", () => kernel.wrapWebPublicRead({} as never, options)],
    ["web admin group", () => kernel.wrapWebGlobalAdmin(null as never)],
    ["verified group", () => kernel.wrapVerified({} as never)],
    ["admin group", () => kernel.wrapGlobalAdmin(1 as never)],
    ["SCIM metadata", () => kernel.wrapScim(invalidProxy as never)],
    ["identity metadata", () => kernel.wrapIdentity(null as never)],
  ];
  try {
    for (const [name, attempt] of attempts) {
      assert.throws(attempt, isHandlerError, name);
      assert.deepEqual(
        counts,
        { service: 0, config: 0, invoke: 0, metadata: 0, option: 0, property: 0 },
        `${name} must reject before any supplied effect`,
      );
    }
  } finally {
    await close();
  }
});

test("owned route constructors and metadata readers reject nonfunctions without descriptor traps or entry", async () => {
  let traps = 0;
  let entries = 0;
  const invalid = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        traps++;
        throw new Error("Descriptor trap");
      },
    },
  );
  const handler = () => new Response("valid");
  const enter = async () => {
    entries++;
    return new Response("entered");
  };
  for (const reader of [identityModes, scimMiddleware])
    assert.throws(() => reader(invalid), isHandlerError);
  assert.throws(() => ownedHttpRoute(invalid as never, enter), isHandlerError);
  assert.throws(() => ownedHttpRoute(handler, invalid as never), isHandlerError);
  assert.throws(() => ownedPublicHttpRoute(null as never, enter), isHandlerError);
  assert.throws(() => ownedPublicHttpRoute(handler, undefined as never), isHandlerError);
  assert.equal(traps, 0);
  assert.equal(entries, 0);
  // The native dispatch fallback intentionally accepts static/opaque values.
  assert.equal(
    await dispatchOwnedRoute(invalid, new Request("http://example.test"), () => undefined),
    undefined,
  );
  assert.equal(
    await dispatchOwnedRoute(
      new Response("static"),
      new Request("http://example.test"),
      () => undefined,
    ),
    undefined,
  );
  assert.equal(traps, 0);
});

test("valid no-argument, asynchronous and narrow-request handlers keep original owned ports and frozen annotations", async () => {
  const { kernel, counts, close } = await fixture();
  interface NarrowRequest extends Request {
    readonly boundaryTag: "narrow";
  }
  const request: NarrowRequest = Object.assign(new Request("http://example.test/narrow"), {
    boundaryTag: "narrow" as const,
  });
  let nested = 0;
  const handle = async (original: NarrowRequest, ports: BusinessRequestPorts) => {
    assert.equal(original, request);
    assert.equal(original.boundaryTag, "narrow");
    assert.deepEqual(await ports.database.execute({ text: "SELECT 23 AS value", params: [] }), [
      { value: 23 },
    ]);
    const inner = kernel.composed<NarrowRequest>((sameRequest, samePorts) => {
      nested++;
      assert.equal(sameRequest, original);
      assert.equal(samePorts, ports);
      return new Response("narrow");
    }, "json");
    return inner(original, ports);
  };
  try {
    const route = ownedHttpRoute(handle, (req, work) => kernel.run(req, work));
    assert.equal(await (await route(request)).text(), "narrow");
    assert.equal(nested, 1);
    assert.equal(counts.invoke, 2, "Nested branded composition must not enter another invocation");
    assert.equal(counts.metadata, 1);
    assert.equal(
      await (await kernel.composed(() => new Response("no-argument"), "json")(request)).text(),
      "no-argument",
    );
    const publicRoute = ownedPublicHttpRoute(
      async () => new Response("public async"),
      async (req, work) => work(req),
    );
    assert.equal(await (await publicRoute(request)).text(), "public async");
    const modes: Array<"identifier" | "bypass"> = ["identifier"];
    const annotated = kernel.wrapIdentity(handle, modes);
    modes.push("bypass");
    assert.deepEqual(identityModes(annotated), ["identifier"]);
    assert.equal(Object.isFrozen(identityModes(annotated)), true);
    const scim = kernel.wrapScim(handle);
    assert.deepEqual(scimMiddleware(scim), []);
    assert.equal(Object.isFrozen(scimMiddleware(scim)), true);
    assert.throws(() => kernel.wrapIdentity(scim), /cannot be combined/);
    assert.throws(() => kernel.wrapScim(annotated), /cannot be combined/);
  } finally {
    await close();
  }
});
