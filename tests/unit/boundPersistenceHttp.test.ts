import { test } from "bun:test";
import assert from "node:assert/strict";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import type { ExecutionEnvelope } from "@getstrata/core/contracts/application";
import type {
  AuthUserDirectory,
  AuthUserRecord,
} from "@getstrata/core/contracts/authUserDirectory";
import { ServiceContainer } from "@getstrata/core/contracts/container";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { csrfMiddlewareOptionsFromEnvironment } from "@getstrata/core/http/csrfMiddleware";
import { createApplication } from "@getstrata/core/runtime/application";
import { hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { createStorageDriver, StorageManager } from "@getstrata/core/storage/storage";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";
import {
  createHttpPersistence,
  HTTP_PERSISTENCE_OPTIONS,
} from "../../src/bootstrap/httpPersistence";
import { ownedHttpRoute } from "../../src/bootstrap/ownedHttpRoute";
import type {
  BusinessRequestPorts,
  HttpPersistenceOptions,
} from "../../src/bootstrap/persistenceContracts";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { createMetadataAuthManager } from "../../src/bootstrap/providers/auth";

test("BP7 actual API and web wrappers roll back writes before error conversion and Basic recovery authenticates once", async () => {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  const canonical = createPersistenceInvocation(app, "main");
  // Explicit unit policy injection: real canonical transactions, no PostgreSQL GUC claim.
  const envelopes: ExecutionEnvelope[] = [];
  const invoke: PersistenceInvocation = (envelope, work) => {
    envelopes.push(envelope);
    return canonical(envelope, (ports) =>
      work({
        ...ports,
        policy: { run: (selected, _policy, callback) => selected.transaction(callback) },
      }),
    );
  };
  const recovery = "1111-2222-3333-4444-5555-6666-7777-8888";
  const password = await Bun.password.hash("correct-password", { algorithm: "bcrypt", cost: 4 });
  let consumption = 0;
  let sessionReads = 0;
  let handlers = 0;
  let bypassEffects = 0;
  const tenant = { id: 1, slug: "one", plan: "free" as const, region: "eu" as const };
  const container = new ServiceContainer();
  const options: HttpPersistenceOptions = {
    tenancy: "rls",
    production: false,
    allowTenantDevHeaders: false,
    metadata(ports) {
      const find = async () => {
        const rows = await ports.database.execute<AuthUserRecord>({
          text: "SELECT id, email, role, password, mfa_enabled, mfa_recovery_codes FROM identity_rows WHERE id=1",
          params: [],
        });
        const record = present(rows[0]);
        return { ...record, mfa_enabled: true };
      };
      const directory: AuthUserDirectory = {
        resolveUserFromToken: async () => null,
        findByIdOrThrow: find,
        findByEmail: find,
      };
      const manager = createMetadataAuthManager(
        directory,
        {
          mechanisms: ["api", "jwt", "basic", "session"],
          mfaSecrets: createMfaSecretCodec({ APP_ENV: "test" }),
          production: false,
          allowDevHeaders: true,
          jwtSecret: "app-specific-signing-secret",
          hasSessionCredential: () => true,
          readSession() {
            sessionReads++;
            return { userId: 1, role: "admin", issuedAt: Math.floor(Date.now() / 1000) };
          },
          abilities: { admin: ["*"], member: [] },
          roleAbilities: () => ["*"],
        },
        async (record, hash) => {
          consumption++;
          const previous = present(record.mfa_recovery_codes);
          const next = JSON.stringify(
            (JSON.parse(previous) as string[]).filter((value) => value !== hash),
          );
          const rows = await ports.database.execute({
            text: "UPDATE identity_rows SET mfa_recovery_codes=? WHERE id=? AND mfa_recovery_codes=? RETURNING id",
            params: [next, record.id, previous],
          });
          return rows.length === 1;
        },
      );
      return {
        authenticate: (request) => manager.authenticate(request),
        memberships: async () => [],
        userTenantId: async () => 1,
        tenant: async (id) => (id === 1 ? tenant : null),
      };
    },
  };
  container.set(HTTP_PERSISTENCE_OPTIONS, {
    csrf: csrfMiddlewareOptionsFromEnvironment(process.env),
    ...options,
  });
  const kernel = createHttpKernel({
    invoke,
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    storage: new StorageManager(createStorageDriver({ driver: "local", rootDirectory: "storage" })),
  });
  const plain = async () => Response.json({ plain: true });
  assert.throws(
    () => kernel.wrapScim(kernel.wrapIdentity(plain, ["bypass"])),
    "SCIM cannot retain an identity-operation grant through nesting",
  );
  assert.throws(
    () => kernel.wrapIdentity(kernel.wrapScim(plain), ["bypass"]),
    "Reverse wrapper order cannot mix SCIM with identity grants",
  );
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await db.execute({
        text: "CREATE TABLE identity_rows (id INTEGER PRIMARY KEY, email TEXT, role TEXT, password TEXT, mfa_enabled INTEGER, mfa_recovery_codes TEXT)",
        params: [],
      });
      await db.execute({
        text: "INSERT INTO identity_rows VALUES (1,'test@example.test','admin',?,1,?)",
        params: [password, JSON.stringify([hashRecoveryCode(recovery)])],
      });
      await db.execute({ text: "CREATE TABLE business_rows (id INTEGER PRIMARY KEY)", params: [] });
    });
    const handler = async (request: Request, ports: BusinessRequestPorts) => {
      handlers++;
      let nestedCalls = 0;
      const nested = kernel.composed((sameRequest, samePorts) => {
        nestedCalls++;
        assert.equal(sameRequest, request);
        assert.equal(samePorts, ports, "Nested composition forwards the original branded ports");
        assert.equal(samePorts.database, ports.database);
        assert.equal(samePorts.auth, ports.auth);
        assert.equal(samePorts.policy, ports.policy);
        assert.equal(samePorts.established, ports.established);
        return new Response("nested");
      }, "json");
      assert.equal((await nested(request, ports)).status, 200);
      assert.equal(nestedCalls, 1);
      await assert.rejects(async () =>
        ports.policy.run(ports.database, { kind: "bypass" }, () => {
          bypassEffects++;
        }),
      );
      assert.equal((await ports.auth.requireUser(request)).id, 1);
      assert.equal((await ports.auth.requireUser()).id, 1);
      assert.equal((await ports.auth.resolve(request))?.id, 1);
      await assert.rejects(
        ports.auth.resolve(new Request(request.url)),
        "A foreign Request cannot borrow established identity",
      );
      await ports.database.execute({
        text: "INSERT INTO business_rows VALUES (?)",
        params: [handlers],
      });
      throw new ForbiddenError("after-write failure");
    };
    const basic = `Basic ${Buffer.from("test@example.test:correct-password").toString("base64")}`;
    const api = await kernel.wrapApi(handler)(
      new Request("http://example.test/api", {
        headers: {
          authorization: basic,
          "x-mfa-code": recovery,
          "x-tenant-id": "1",
          accept: "application/json",
        },
      }),
    );
    assert.equal(
      api.status,
      403,
      JSON.stringify({ consumption, handlers, sessionReads, body: await api.clone().text() }),
    );
    assert.equal(
      consumption,
      1,
      "Metadata and repeated business guards consume one recovery proof once",
    );
    assert.equal(sessionReads, 0, "Basic proof cannot fall through to configured session");
    const web = await kernel.wrapWeb(handler)(
      new Request("http://example.test/web", {
        headers: { "x-tenant-id": "1", accept: "application/json" },
      }),
    );
    assert.equal(web.status, 403);
    for (const authorization of [basic, "Bearer invalid-supplied-proof"]) {
      const denied = await kernel.wrapApi(handler)(
        new Request("http://example.test/denied", {
          headers: {
            authorization,
            "x-mfa-code": recovery,
            "x-tenant-id": "1",
            "x-user-id": "1",
            "x-user-role": "admin",
            accept: "application/json",
          },
        }),
      );
      assert.equal(
        denied.status,
        401,
        "Invalid/replayed proof must not fall through to session or dev identity",
      );
    }
    assert.equal(handlers, 2);
    assert.equal(bypassEffects, 0);
    assert.equal(consumption, 1);
    assert.equal(sessionReads, 1);
    await app.run(async (scope) => {
      assert.deepEqual(
        await scope
          .resolve(DATABASE_SESSION_TOKEN)
          .execute({ text: "SELECT id FROM business_rows", params: [] }),
        [],
        "Actual wrapApi/wrapWeb error formatters cannot commit failed writes",
      );
    });
    const beforeIdentity = envelopes.length;
    const identity = kernel.wrapApi(
      kernel.wrapIdentity(
        async (_request, ports) => {
          assert.equal(
            "requestRollback" in ports.database,
            false,
            "Identity operation starts on selected root, not normal tenant transaction",
          );
          await assert.rejects(async () =>
            ports.policy.run(ports.database, { kind: "bypass" }, () => {
              bypassEffects++;
            }),
          );
          return ports.policy.run(
            ports.database,
            { kind: "identifier", identifier: 1 },
            async (child) => {
              assert.notEqual(child, ports.database);
              await assert.rejects(async () =>
                ports.database.execute({ text: "SELECT id FROM business_rows", params: [] }),
              );
              await child.execute({ text: "INSERT INTO business_rows VALUES (77)", params: [] });
              return Response.json({ identity: true });
            },
          );
        },
        ["identifier"],
      ),
    );
    const identityResponse = await identity(
      new Request("http://example.test/identity", {
        headers: { accept: "application/json", "x-tenant-id": "1" },
      }),
    );
    assert.equal(identityResponse.status, 200);
    assert.deepEqual(
      envelopes.slice(beforeIdentity).map((envelope) => envelope.metadata?.phase),
      ["metadata", "identity-operation"],
      "Identity declaration survives API wrapping without a second business invocation",
    );
    const identityEnvelope = envelopes.at(-1);
    assert.equal(identityEnvelope?.actor?.kind, "system");
    if (identityEnvelope?.actor?.kind === "system")
      assert.equal(identityEnvelope.actor.policy, "http.identity-operation");
    assert.equal(bypassEffects, 0);

    let nativeEntries = 0;
    let nativeCalls = 0;
    let selectedPorts: BusinessRequestPorts | undefined;
    let selectedRequest: Request | undefined;
    const nativeRoute = ownedHttpRoute(
      async (request, ports) => {
        nativeCalls++;
        assert.equal(request, selectedRequest);
        assert.equal(
          ports,
          selectedPorts,
          "Bun's native server argument must enter owned dispatch",
        );
        assert.equal((await ports.auth.requireUser(request)).id, 1);
        const rows = await ports.database.execute<{ value: number }>({
          text: "SELECT 1 AS value",
          params: [],
        });
        assert.equal(rows[0]?.value, 1);
        return new Response("native owned ports");
      },
      (request, work) => {
        nativeEntries++;
        return kernel.run(request, (sameRequest, ports) => {
          selectedRequest = sameRequest;
          selectedPorts = ports;
          return work(sameRequest, ports);
        });
      },
    );
    // Assign directly: Bun itself supplies its native Server as the second argument.
    const nativeServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: nativeRoute });
    try {
      const response = await fetch(`http://127.0.0.1:${nativeServer.port}/native-owned`, {
        headers: { accept: "application/json", "x-tenant-id": "1" },
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "native owned ports");
      assert.equal(nativeEntries, 1);
      assert.equal(nativeCalls, 1);
    } finally {
      await nativeServer.stop(true);
    }
  } finally {
    kernel.dispose();
    await app.stop();
  }
});

function present<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

test("HTTP identity snapshot preserves profile and security fields without retaining mutable directory records", async () => {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  const verifiedAt = new Date("2026-01-02T03:04:05Z");
  let name = "Profile Name";
  let email = "profile@example.test";
  let nameReads = 0;
  let emailReads = 0;
  const user = {
    id: 7,
    get name() {
      assert.equal(++nameReads, 1, "Profile name must be captured once before validation");
      return name;
    },
    set name(value: string) {
      name = value;
    },
    get email() {
      assert.equal(++emailReads, 1, "Profile email must be captured once before validation");
      return email;
    },
    set email(value: string) {
      email = value;
    },
    role: "member",
    isActive: true,
    authVersion: 3,
    tokenId: 11,
    abilities: ["notes:read"],
    emailVerifiedAt: verifiedAt,
    password: "must-never-reach-business-context",
  };
  let authentications = 0;
  const http = createHttpPersistence(createPersistenceInvocation(app, "main"), {
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    metadata: () => ({
      authenticate: async () => {
        authentications++;
        return { status: "authenticated", user, credentialSource: "session" as const };
      },
      memberships: async () => [],
      userTenantId: async () => 1,
      tenant: async () => ({ id: 1, slug: "default" }),
    }),
  });
  try {
    const request = new Request("http://example.test/profile");
    const response = await http(request, async (_request, ports) => {
      user.name = "Changed";
      user.email = "changed@example.test";
      user.role = "admin";
      user.authVersion = 99;
      user.abilities.push("*");
      verifiedAt.setUTCFullYear(2040);
      const snapshot = await ports.auth.requireUser(request);
      assert.deepEqual(snapshot, {
        id: 7,
        name: "Profile Name",
        email: "profile@example.test",
        role: "member",
        isActive: true,
        authVersion: 3,
        tokenId: 11,
        abilities: ["notes:read"],
        emailVerifiedAt: "2026-01-02T03:04:05.000Z",
      });
      assert.equal(Object.isFrozen(snapshot), true);
      assert.equal(Object.isFrozen(snapshot.abilities), true);
      assert.equal("password" in snapshot, false);
      assert.equal(ports.established.auth.user, snapshot);
      assert.equal((await ports.auth.resolveWithSource(request)).credentialSource, "session");
      return new Response("profile");
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "profile");
    assert.equal(authentications, 1);
    assert.equal(nameReads, 1);
    assert.equal(emailReads, 1);
  } finally {
    await app.stop();
  }
});

async function compositionFixture(options: HttpPersistenceOptions, afterMetadata?: () => void) {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  const envelopes: ExecutionEnvelope[] = [];
  const canonical = createPersistenceInvocation(app, "main");
  const invoke: PersistenceInvocation = async (envelope, work) => {
    envelopes.push(envelope);
    const value = await canonical(envelope, work);
    if (envelope.metadata?.phase === "metadata") afterMetadata?.();
    return value;
  };
  const container = new ServiceContainer();
  container.set(HTTP_PERSISTENCE_OPTIONS, {
    csrf: csrfMiddlewareOptionsFromEnvironment(process.env),
    ...options,
  });
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache()));
  const kernel = createHttpKernel({
    invoke,
    container,
    cache,
    storage: new StorageManager(createStorageDriver({ driver: "local", rootDirectory: "storage" })),
  });
  await app.run((scope) =>
    scope
      .resolve(DATABASE_SESSION_TOKEN)
      .execute({ text: "CREATE TABLE composition_rows (id INTEGER)", params: [] }),
  );
  return {
    app,
    kernel,
    envelopes,
    rows: () =>
      app.run((scope) =>
        scope
          .resolve(DATABASE_SESSION_TOKEN)
          .execute<{ id: number }>({ text: "SELECT id FROM composition_rows", params: [] }),
      ),
    close: async () => {
      kernel.dispose();
      assert.equal((await app.stop()).successful, true);
      await cache.close();
    },
  };
}
const noIdentityMetadata: HttpPersistenceOptions["metadata"] = () => ({
  authenticate: async () => ({ status: "absent", user: null, credentialSource: null }),
  memberships: async () => [],
  userTenantId: async () => 1,
  tenant: async () => null,
});

for (const mode of ["missing", "rejected"] as const) {
  test(`HTTP SCIM ${mode} metadata denies business admission and SQL`, async () => {
    let metadataCalls = 0;
    let scimCalls = 0;
    let handlers = 0;
    const fixture = await compositionFixture({
      tenancy: "none",
      production: false,
      allowTenantDevHeaders: false,
      metadata: (ports) => {
        metadataCalls++;
        return noIdentityMetadata(ports);
      },
      ...(mode === "rejected"
        ? {
            scim: async (
              _request: Request,
              database: import("@getstrata/core/database/session").DatabaseSession,
            ) => {
              scimCalls++;
              assert.equal((await database.execute({ text: "SELECT 1", params: [] })).length, 1);
              return Response.json({ detail: "SCIM proof rejected" }, { status: 401 });
            },
          }
        : {}),
    });
    try {
      const route = fixture.kernel.wrapScim(async (_request, ports) => {
        handlers++;
        await ports.database.execute({
          text: "INSERT INTO composition_rows VALUES (1)",
          params: [],
        });
        return new Response("unexpected business");
      });
      const response = await route(new Request("http://example.test/scim/Users"));
      assert.equal(response.status, mode === "missing" ? 500 : 401);
      if (mode === "rejected")
        assert.deepEqual(await response.json(), { detail: "SCIM proof rejected" });
      assert.equal(handlers, 0);
      assert.equal(metadataCalls, 0);
      assert.equal(scimCalls, mode === "missing" ? 0 : 1);
      assert.deepEqual(
        fixture.envelopes.map((envelope) => envelope.metadata?.phase),
        ["metadata"],
      );
      assert.deepEqual(await fixture.rows(), []);
    } finally {
      await fixture.close();
    }
  });
}

test("HTTP SCIM callback uses its selected session and a detached tenant snapshot with system actor", async () => {
  const tenant = { id: 3, slug: "scim-three", metadata: { tags: ["original"] } };
  let callbacks = 0;
  let normalMetadata = 0;
  const fixture = await compositionFixture(
    {
      tenancy: "column",
      production: false,
      allowTenantDevHeaders: false,
      metadata: (ports) => {
        normalMetadata++;
        return noIdentityMetadata(ports);
      },
      scim: async (request, database) => {
        callbacks++;
        assert.equal(new URL(request.url).pathname, "/scim/Users");
        assert.equal(
          (await database.execute<{ value: number }>({ text: "SELECT 7 AS value", params: [] }))[0]
            ?.value,
          7,
        );
        return tenant;
      },
    },
    () => {
      tenant.id = 99;
      tenant.slug = "mutated";
      tenant.metadata.tags.push("mutated");
    },
  );
  try {
    const response = await fixture.kernel.wrapScim(async (request, ports) => {
      assert.deepEqual(ports.established.tenant, {
        id: 3,
        slug: "scim-three",
        metadata: { tags: ["original"] },
      });
      assert.equal(Object.isFrozen(ports.established.tenant), true);
      assert.equal(currentTenant(), ports.established.tenant);
      assert.equal(await ports.auth.user(request), null);
      assert.deepEqual(await ports.auth.resolveWithSource(request), {
        user: null,
        credentialSource: "bearer",
      });
      await ports.database.execute({ text: "INSERT INTO composition_rows VALUES (3)", params: [] });
      return new Response("scim admitted");
    })(new Request("http://example.test/scim/Users"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "scim admitted");
    assert.equal(callbacks, 1);
    assert.equal(normalMetadata, 0);
    assert.deepEqual(
      fixture.envelopes.map((envelope) => ({
        phase: envelope.metadata?.phase,
        actor: envelope.actor,
        tenant: envelope.tenant,
      })),
      [
        {
          phase: "metadata",
          actor: { kind: "system", policy: "http.identity-metadata" },
          tenant: undefined,
        },
        {
          phase: "business",
          actor: { kind: "system", policy: "http.scim" },
          tenant: { id: 3, slug: "scim-three" },
        },
      ],
    );
    assert.deepEqual(await fixture.rows(), [{ id: 3 }]);
  } finally {
    await fixture.close();
  }
});

test("HTTP mismatched tenant lookup is denied before business invocation or SQL", async () => {
  let handlers = 0;
  let resolutions = 0;
  const fixture = await compositionFixture({
    tenancy: "column",
    production: false,
    allowTenantDevHeaders: false,
    metadata: () => ({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: 1, role: "member" },
        credentialSource: "session",
      }),
      memberships: async () => [],
      userTenantId: async () => 1,
      tenant: async (id) => {
        resolutions++;
        return { id: id + 1, slug: "wrong" };
      },
    }),
  });
  try {
    const response = await fixture.kernel.wrapApi(async (_request, ports) => {
      handlers++;
      await ports.database.execute({ text: "INSERT INTO composition_rows VALUES (1)", params: [] });
      return new Response("unexpected");
    })(new Request("http://example.test/private"));
    assert.equal(response.status, 500);
    assert.equal(resolutions, 1);
    assert.equal(handlers, 0);
    assert.deepEqual(
      fixture.envelopes.map((envelope) => envelope.metadata?.phase),
      ["metadata"],
    );
    assert.deepEqual(await fixture.rows(), []);
  } finally {
    await fixture.close();
  }
});

test("identity routes cannot select tenant policy or submit its business SQL", async () => {
  let attempted = 0;
  let admitted = 0;
  let policyDenial: unknown;
  const fixture = await compositionFixture({
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    metadata: noIdentityMetadata,
  });
  try {
    const response = await fixture.kernel.wrap(
      "api",
      fixture.kernel.wrapIdentity(async (_request, ports) => {
        attempted++;
        try {
          return await ports.policy.run(
            ports.database,
            { kind: "tenant", tenantId: 1 },
            async (child) => {
              admitted++;
              await child.execute({ text: "INSERT INTO composition_rows VALUES (1)", params: [] });
              return new Response("unexpected");
            },
          );
        } catch (error) {
          policyDenial = error;
          throw error;
        }
      }),
    )(new Request("http://example.test/identity"));
    assert.equal(response.status, 500);
    assert.equal(attempted, 1);
    assert.equal(admitted, 0);
    assert.ok(policyDenial instanceof Error);
    assert.equal(policyDenial.message, "Database policy is not allowed by this route declaration.");
    assert.equal(fixture.envelopes.at(-1)?.metadata?.phase, "identity-operation");
    assert.deepEqual(await fixture.rows(), []);
  } finally {
    await fixture.close();
  }
});

test("established auth user and membership snapshots restore through nested and competing HTTP requests", async () => {
  const { establishedAuthReader } = await import("@getstrata/core/auth/authReader");
  const { currentOrganizationIds, currentOrgRole } = await import(
    "@getstrata/core/auth/membershipContext"
  );
  const { bounded, deferred } = await import("../fixtures/applicationOwnershipSupport");
  const entered = deferred();
  let outerEntered = 0;
  let authentications = 0;
  const fixture = await compositionFixture({
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    metadata: () => ({
      authenticate: async (request) => {
        authentications++;
        return {
          status: "authenticated",
          user: { id: Number(new URL(request.url).searchParams.get("id")), role: "member" },
          credentialSource: "session",
        };
      },
      memberships: async (user) => [{ organization_id: Number(user.id) * 10, role: "member" }],
      userTenantId: async () => 1,
      tenant: async () => null,
    }),
  });
  let route: (request: Request) => Response | Promise<Response>;
  route = fixture.kernel.wrapApi(async (request, ports) => {
    const snapshot = ports.established.auth.user;
    assert.ok(snapshot);
    const id = Number(snapshot.id);
    const assertOwned = async () => {
      assert.equal(await establishedAuthReader.user(), snapshot);
      assert.equal(await ports.auth.user(request), snapshot);
      assert.deepEqual(currentOrganizationIds(), [id * 10]);
      assert.equal(currentOrgRole(id * 10), "member");
      await assert.rejects(ports.auth.user(new Request(request.url)), /scope mismatch/);
    };
    await assertOwned();
    if (id < 10) {
      if (++outerEntered === 2) entered.resolve();
      await entered.promise;
      await assertOwned();
      const nested = await route(new Request(`http://example.test/identity?id=${id + 10}`));
      assert.equal(nested.status, 200);
      await nested.text();
      await assertOwned();
    }
    await ports.database.execute({ text: "INSERT INTO composition_rows VALUES (?)", params: [id] });
    return new Response(`identity-${id}`);
  });
  try {
    await assert.rejects(establishedAuthReader.user(), /scope mismatch/);
    const responses = await bounded(
      Promise.all([
        route(new Request("http://example.test/identity?id=1")),
        route(new Request("http://example.test/identity?id=2")),
      ]),
    );
    assert.deepEqual(await Promise.all(responses.map((response) => response.text())), [
      "identity-1",
      "identity-2",
    ]);
    assert.equal(authentications, 4);
    assert.deepEqual(
      (await fixture.rows()).map((row) => row.id).sort((a, b) => Number(a) - Number(b)),
      [1, 2, 11, 12],
    );
    await assert.rejects(establishedAuthReader.user(), /scope mismatch/);
    assert.deepEqual(currentOrganizationIds(), []);
  } finally {
    entered.resolve();
    await fixture.close();
  }
});

test("owned HTTP business admission carries detached principal claims and never elevates a guest", async () => {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  const envelopes: ExecutionEnvelope[] = [];
  const canonical = createPersistenceInvocation(app, "main");
  const invoke: PersistenceInvocation = (envelope, work) => {
    envelopes.push(envelope);
    return canonical(envelope, work);
  };
  let user: {
    id: number;
    role: string;
    isActive: boolean;
    abilities: string[];
    password: string;
  } | null = {
    id: 83,
    role: "member",
    isActive: true,
    abilities: ["notes:read"],
    password: "private-directory-secret",
  };
  let authentications = 0;
  const container = new ServiceContainer();
  container.set(HTTP_PERSISTENCE_OPTIONS, {
    csrf: csrfMiddlewareOptionsFromEnvironment(process.env),
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    metadata: () => ({
      authenticate: async () => {
        authentications++;
        return user
          ? { status: "authenticated", user, credentialSource: "session" }
          : { status: "absent", user: null, credentialSource: null };
      },
      memberships: async () => [],
      userTenantId: async () => 1,
      tenant: async () => null,
    }),
  } satisfies HttpPersistenceOptions);
  const kernel = createHttpKernel({
    invoke,
    container,
    cache: new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20))),
    storage: new StorageManager(createStorageDriver({ driver: "local", rootDirectory: "storage" })),
  });
  const route = kernel.composed(async (request, ports) => {
    const actor = present(envelopes.at(-1)).actor;
    assert.deepEqual(ports.established.tenant, DEFAULT_TENANT);
    assert.notEqual(ports.established.tenant, DEFAULT_TENANT);
    assert.equal(currentTenant(), ports.established.tenant);
    assert.deepEqual(present(envelopes.at(-1)).tenant, DEFAULT_TENANT);
    if (user) {
      assert.deepEqual(actor, {
        kind: "principal",
        claims: { id: 83, role: "member", isActive: true, abilities: ["notes:read"] },
      });
      assert.equal(actor?.kind, "principal");
      if (actor?.kind === "principal") {
        assert.equal(Object.hasOwn(actor.claims, "password"), false);
        assert.notEqual(actor.claims.abilities, user.abilities);
      }
      user.role = "admin";
      user.abilities.push("*");
      assert.equal((await ports.auth.requireUser(request)).role, "member");
      assert.deepEqual(ports.established.auth.user?.abilities, ["notes:read"]);
    } else {
      assert.equal(actor, undefined);
      assert.equal(ports.established.auth.user, null);
      await assert.rejects(ports.auth.requireUser(request));
      await assert.rejects(
        async () =>
          ports.policy.run(ports.database, { kind: "bypass" }, () => {
            throw new Error("Guest bypass must never be admitted");
          }),
        /not allowed by this route declaration/,
      );
    }
    assert.deepEqual(await ports.database.execute({ text: "SELECT 83 AS value", params: [] }), [
      { value: 83 },
    ]);
    return new Response(user ? "principal" : "guest");
  }, "json");
  try {
    assert.equal(
      await (await route(new Request("http://example.test/principal"))).text(),
      "principal",
    );
    user = null;
    assert.equal(await (await route(new Request("http://example.test/guest"))).text(), "guest");
    assert.equal(authentications, 2);
    assert.deepEqual(
      envelopes.map((envelope) => ({
        phase: envelope.metadata?.phase,
        actor: envelope.actor?.kind,
      })),
      [
        { phase: "metadata", actor: "system" },
        { phase: "business", actor: "principal" },
        { phase: "metadata", actor: "system" },
        { phase: "business", actor: undefined },
      ],
    );
  } finally {
    await kernel.dispose();
    assert.equal((await app.stop()).successful, true);
  }
});

import { currentTenant } from "@getstrata/core/tenant/tenantContext";
import { DEFAULT_TENANT } from "@getstrata/core/tenant/tenantMiddleware";

test("malformed public SCIM metadata never admits business work or substitutes a default tenant", async () => {
  const invalid: unknown[] = [
    null,
    undefined,
    false,
    "tenant",
    1,
    [],
    { id: 0, slug: "zero" },
    { id: -1, slug: "negative" },
    { id: 1.5, slug: "fraction" },
    { id: Number.MAX_SAFE_INTEGER + 1, slug: "unsafe" },
    { id: NaN, slug: "nan" },
    { id: "1", slug: "string" },
    { slug: "missing-id" },
    { id: 1 },
    { id: 1, slug: null },
    { id: 1, slug: 7 },
  ];
  let returned: unknown;
  let scimCalls = 0;
  let normalMetadata = 0;
  let handlers = 0;
  const fixture = await compositionFixture({
    tenancy: "column",
    production: false,
    allowTenantDevHeaders: false,
    metadata: (ports) => {
      normalMetadata++;
      return noIdentityMetadata(ports);
    },
    scim: async () => {
      scimCalls++;
      return returned as never;
    },
  });
  const route = fixture.kernel.wrapScim(async (_request, ports) => {
    handlers++;
    await ports.database.execute({ text: "INSERT INTO composition_rows VALUES (999)", params: [] });
    return new Response("Malformed tenant admitted", { status: 200 });
  });
  try {
    for (const [index, value] of invalid.entries()) {
      returned = value;
      const before = fixture.envelopes.length;
      const response = await route(new Request(`http://example.test/scim/Users?case=${index}`));
      assert.equal(response.status, 500);
      assert.equal(
        scimCalls,
        index + 1,
        "SCIM authenticates exactly once per rejected metadata result",
      );
      assert.equal(normalMetadata, 0);
      assert.equal(handlers, 0);
      assert.deepEqual(
        fixture.envelopes
          .slice(before)
          .map((envelope) => ({ phase: envelope.metadata?.phase, tenant: envelope.tenant })),
        [{ phase: "metadata", tenant: undefined }],
        "No business envelope means no business policy, SQL or handler admission",
      );
      assert.deepEqual(await fixture.rows(), []);
      assert.equal(currentTenant(), null);
    }
  } finally {
    await fixture.close();
  }
});

test("ordinary selected tenant snapshots validate before equality and retain detached opaque extensions", async () => {
  let idReads = 0;
  let slugReads = 0;
  let resolutions = 0;
  let authentications = 0;
  const extension = {
    arbitraryPlan: "custom",
    tags: ["original"],
    at: new Date("2026-01-01T00:00:00Z"),
    values: new Map([["key", "value"]]),
  };
  const tenant = {
    get id() {
      idReads++;
      return idReads === 1 ? 1 : 77;
    },
    get slug() {
      slugReads++;
      return "";
    },
    plan: "application-defined",
    region: 42,
    metadata: extension,
  };
  const fixture = await compositionFixture(
    {
      tenancy: "column",
      production: false,
      allowTenantDevHeaders: false,
      metadata: () => ({
        authenticate: async () => {
          authentications++;
          return {
            status: "authenticated",
            user: { id: 7, role: "member" },
            credentialSource: "session",
          };
        },
        memberships: async () => [],
        userTenantId: async () => 1,
        tenant: async () => {
          resolutions++;
          return tenant;
        },
      }),
    },
    () => {
      extension.tags.push("mutated");
      extension.at.setUTCFullYear(2040);
      extension.values.set("key", "mutated");
    },
  );
  try {
    const response = await fixture.kernel.composed(async (_request, ports) => {
      assert.equal(ports.established.tenant.id, 1);
      assert.equal(ports.established.tenant.slug, "", "String slug need not be nonempty");
      assert.equal(ports.established.tenant.plan, "application-defined");
      assert.equal(ports.established.tenant.region, 42);
      assert.deepEqual(ports.established.tenant.metadata, {
        arbitraryPlan: "custom",
        tags: ["original"],
        at: new Date("2026-01-01T00:00:00Z"),
        values: new Map([["key", "value"]]),
      });
      assert.notEqual(ports.established.tenant.metadata, extension);
      assert.equal(Object.isFrozen(ports.established.tenant), true);
      assert.equal(currentTenant(), ports.established.tenant);
      await ports.database.execute({ text: "INSERT INTO composition_rows VALUES (1)", params: [] });
      return new Response("snapshot");
    }, "json")(new Request("http://example.test/member"));
    assert.equal(response.status, 200);
    assert.deepEqual(
      { idReads, slugReads, resolutions, authentications },
      { idReads: 1, slugReads: 1, resolutions: 1, authentications: 1 },
    );
    assert.deepEqual(fixture.envelopes.at(-1)?.tenant, { id: 1, slug: "" });
    assert.equal(fixture.envelopes.at(-1)?.actor?.kind, "principal");
    assert.deepEqual(await fixture.rows(), [{ id: 1 }]);
    assert.equal(currentTenant(), null);
  } finally {
    await fixture.close();
  }
});

test("ordinary metadata preserves missing-tenant refusal and rejects malformed selected tenant shape", async () => {
  let returned: unknown;
  let resolutions = 0;
  let handlers = 0;
  const fixture = await compositionFixture({
    tenancy: "column",
    production: false,
    allowTenantDevHeaders: false,
    metadata: () => ({
      authenticate: async () => ({
        status: "authenticated",
        user: { id: 7, role: "member" },
        credentialSource: "session",
      }),
      memberships: async () => [],
      userTenantId: async () => 1,
      tenant: async () => {
        resolutions++;
        return returned as never;
      },
    }),
  });
  const route = fixture.kernel.composed(async () => {
    handlers++;
    return new Response("Unexpected tenant");
  }, "json");
  try {
    for (const [index, value] of [null, undefined, { id: 1, slug: 7 }].entries()) {
      returned = value;
      const before = fixture.envelopes.length;
      const response = await route(new Request("http://example.test/member"));
      assert.equal(response.status, value === null ? 403 : 500);
      assert.equal(resolutions, index + 1);
      assert.equal(handlers, 0);
      assert.deepEqual(
        fixture.envelopes.slice(before).map((envelope) => envelope.metadata?.phase),
        ["metadata"],
      );
      assert.deepEqual(await fixture.rows(), []);
    }
  } finally {
    await fixture.close();
  }
});

test("HTTP metadata rejects invalid and malformed auth outcomes before entering business scope", async () => {
  const outcomes: unknown[] = [
    { status: "invalid", user: null, credentialSource: "bearer" },
    { status: "absent", user: { id: 1, role: "admin" }, credentialSource: null },
    { status: "authenticated", user: null, credentialSource: "session" },
    { status: "unknown", user: { id: 1 }, credentialSource: "session" },
    ...[undefined, null, false, 0, ""].map((error) => ({
      status: "error",
      user: null,
      credentialSource: "bearer",
      error,
    })),
  ];
  for (const outcome of outcomes) {
    let memberships = 0,
      handled = 0;
    const fixture = await compositionFixture({
      tenancy: "none",
      production: false,
      allowTenantDevHeaders: false,
      metadata: () => ({
        authenticate: async () => outcome as import("@getstrata/core/auth/guard").AuthOutcome,
        memberships: async () => {
          memberships++;
          return [];
        },
        userTenantId: async () => 1,
        tenant: async () => null,
      }),
    });
    try {
      const response = await fixture.kernel.wrapApi(async () => {
        handled++;
        return new Response("unexpected");
      })(new Request("http://example.test/private"));
      assert.equal(
        response.status,
        (outcome as { status: string }).status === "invalid" ? 401 : 500,
      );
      assert.equal(memberships, 0);
      assert.equal(handled, 0);
      assert.equal(
        fixture.envelopes.filter((envelope) => envelope.actor?.kind === "principal").length,
        0,
      );
    } finally {
      await fixture.close();
    }
  }
});

test("invalid owned session cookies expire on denial without admitting or downgrading the request", async () => {
  let handled = 0;
  let memberships = 0;
  const cookie = {
    name: "owner_a_session",
    expiredHeader: "owner_a_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  };
  const fixture = await compositionFixture({
    tenancy: "none",
    production: false,
    allowTenantDevHeaders: false,
    invalidSessionCookie: cookie,
    metadata: () => ({
      authenticate: async (request) =>
        request.headers.has("cookie")
          ? { status: "invalid", user: null, credentialSource: "session" }
          : { status: "absent", user: null, credentialSource: null },
      memberships: async () => {
        memberships++;
        return [];
      },
      userTenantId: async () => 1,
      tenant: async () => null,
    }),
  });
  // Ownership includes this declaration: mutating caller config cannot redirect cleanup.
  cookie.name = "owner_b_session";
  cookie.expiredHeader = "owner_b_session=; Max-Age=0";
  const handler = fixture.kernel.wrap("api", async () => {
    handled++;
    return new Response("guest login page");
  });
  try {
    const response = await handler(
      new Request("http://example.test/auth/csrf", {
        headers: { cookie: "owner_a_session=revoked" },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get("set-cookie"),
      "owner_a_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    assert.equal(handled, 0, "The rejected request cannot execute even an anonymous handler");
    assert.equal(memberships, 0);
    assert.equal(fixture.envelopes.filter((e) => e.metadata?.phase === "business").length, 0);
    assert.equal(fixture.envelopes.filter((e) => e.actor?.kind === "principal").length, 0);
    const clean = await handler(new Request("http://example.test/auth/csrf"));
    assert.equal(
      clean.status,
      200,
      "A new request after cookie expiration may begin ordinary guest login",
    );
    assert.equal(
      clean.headers.getSetCookie().some((value) => value.startsWith("owner_a_session=")),
      false,
    );
    assert.equal(handled, 1);
  } finally {
    await fixture.close();
  }
});

for (const scenario of [
  {
    name: "forged bearer alongside a valid session",
    outcome: { status: "invalid", user: null, credentialSource: "bearer" },
    cookie: "owner_session=valid",
    status: 401,
  },
  {
    name: "invalid different owner's session",
    outcome: { status: "invalid", user: null, credentialSource: "session" },
    cookie: "other_session=revoked",
    status: 401,
  },
  {
    name: "session lookup operational error",
    outcome: {
      status: "error",
      user: null,
      credentialSource: "session",
      error: new Error("fixture lookup failed"),
    },
    cookie: "owner_session=valid",
    status: 500,
  },
  {
    name: "valid session with business authorization denial",
    outcome: {
      status: "authenticated",
      user: { id: 1, role: "member" },
      credentialSource: "session",
    },
    cookie: "owner_session=valid",
    status: 401,
  },
] as const) {
  test(`session cleanup does not erase credentials for ${scenario.name}`, async () => {
    let handled = 0;
    const fixture = await compositionFixture({
      tenancy: "none",
      production: false,
      allowTenantDevHeaders: false,
      invalidSessionCookie: {
        name: "owner_session",
        expiredHeader: "owner_session=; Path=/; Max-Age=0",
      },
      metadata: () => ({
        authenticate: async () => scenario.outcome,
        memberships: async () => [],
        userTenantId: async () => 1,
        tenant: async () => null,
      }),
    });
    try {
      const response = await fixture.kernel.wrap("api", async () => {
        handled++;
        return new Response("denied", { status: 401 });
      })(
        new Request("http://example.test/private", {
          headers: { cookie: scenario.cookie, authorization: "Bearer forged" },
        }),
      );
      assert.equal(response.status, scenario.status);
      assert.equal(
        response.headers.getSetCookie().some((value) => value.startsWith("owner_session=")),
        false,
      );
      assert.equal(handled, scenario.outcome.status === "authenticated" ? 1 : 0);
    } finally {
      await fixture.close();
    }
  });
}
