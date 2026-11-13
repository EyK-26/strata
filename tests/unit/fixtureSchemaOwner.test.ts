import { afterAll, expect, mock, test } from "bun:test";

const runtimePath = new URL("../../src/core/runtime/application.ts", import.meta.url).pathname;
const invocationPath = new URL("../../src/bootstrap/persistenceInvocation.ts", import.meta.url)
  .pathname;
// Capture values, not the live module namespace that Bun updates when a module is mocked.
const originalRuntime = { ...(await import(runtimePath)) };
const originalInvocation = { ...(await import(invocationPath)) };
const environment = {
  APP_ENV: process.env.APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};
const state: {
  starts: number;
  stops: number;
  invocations: number;
  policyRuns: number;
  statements: Array<{ text: string; params: readonly unknown[] }>;
  stopMode: "success" | "throw" | "report";
  cleanup: unknown;
  report: object;
} = {
  starts: 0,
  stops: 0,
  invocations: 0,
  policyRuns: 0,
  statements: [],
  stopMode: "success",
  cleanup: undefined,
  report: { successful: false },
};
const root = {};
const selected = {
  async execute(statement: { text: string; params: readonly unknown[] }) {
    state.statements.push(statement);
    return [];
  },
};
mock.module(runtimePath, () => ({
  ...originalRuntime,
  createApplication: () => ({
    async start() {
      state.starts++;
    },
    async stop(options: { reason: string }) {
      state.stops++;
      expect(options.reason).toBe("fixture schema command complete");
      if (state.stopMode === "throw") throw state.cleanup;
      return state.stopMode === "report" ? state.report : { successful: true };
    },
  }),
}));
mock.module(invocationPath, () => ({
  ...originalInvocation,
  createPersistenceInvocation: (_application: unknown, connection: string) => {
    expect(connection).toBe("main");
    return async (
      envelope: unknown,
      work: (ports: {
        database: object;
        policy: {
          run: (
            database: object,
            policy: unknown,
            body: (database: typeof selected) => Promise<unknown>,
          ) => Promise<unknown>;
        };
      }) => Promise<unknown>,
    ) => {
      state.invocations++;
      expect(envelope).toEqual({
        kind: "command",
        actor: { kind: "system", policy: "fixture.schema-command" },
      });
      return work({
        database: root,
        policy: {
          async run(database, policy, body) {
            state.policyRuns++;
            expect(database).toBe(root);
            expect(policy).toEqual({ kind: "bypass" });
            return body(selected);
          },
        },
      });
    };
  },
}));
// This is the ACTUAL frozen source module, not a copied owner body. Only orchestration
// dependencies are controlled; this suite makes no native ACK/cleanup protocol claim.
const { fixtureDatabaseUrl, withFixtureSchema, FIXTURE_SCHEMA_LOCK_KEY } = await import(
  "../../src/db/fixtureSchemaOwner"
);
function reset() {
  Object.assign(state, {
    starts: 0,
    stops: 0,
    invocations: 0,
    policyRuns: 0,
    statements: [],
    stopMode: "success",
    cleanup: undefined,
    report: { successful: false },
  });
  process.env.APP_ENV = "testing";
  process.env.NODE_ENV = "test";
}
function assertOwnedWork() {
  expect(state.starts).toBe(1);
  expect(state.stops).toBe(1);
  expect(state.invocations).toBe(1);
  expect(state.policyRuns).toBe(1);
  expect(state.statements).toEqual([
    { text: "SELECT pg_advisory_xact_lock($1)", params: [FIXTURE_SCHEMA_LOCK_KEY] },
  ]);
}
async function failure(work: () => Promise<unknown>) {
  try {
    await work();
    return { failed: false as const };
  } catch (error) {
    return { failed: true as const, error };
  }
}
afterAll(async () => {
  mock.module(runtimePath, () => originalRuntime);
  mock.module(invocationPath, () => originalInvocation);
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  expect((await import(runtimePath)).createApplication).toBe(originalRuntime.createApplication);
  expect((await import(invocationPath)).createPersistenceInvocation).toBe(
    originalInvocation.createPersistenceInvocation,
  );
});

test("fixture target guards reject production, invalid protocol and missing path before any owner starts", async () => {
  reset();
  for (const [mode, node] of [
    ["production", "test"],
    ["staging", "test"],
    ["testing", "production"],
  ] as const) {
    process.env.APP_ENV = mode;
    process.env.NODE_ENV = node;
    await expect(
      withFixtureSchema(
        async () => {
          throw Error("must not enter");
        },
        { databaseUrl: "postgres://fixture/db" },
      ),
    ).rejects.toThrow("disabled outside development/test");
  }
  process.env.APP_ENV = "testing";
  process.env.NODE_ENV = "test";
  for (const url of [
    "not a URL",
    "sqlite://:memory:",
    "mysql://fixture/db",
    "postgres://fixture",
    "postgres://fixture/",
  ]) {
    await expect(
      withFixtureSchema(
        async () => {
          throw Error("must not enter");
        },
        { databaseUrl: url },
      ),
    ).rejects.toThrow("must be a PostgreSQL database URL");
  }
  process.env.DATABASE_URL = " ";
  await expect(
    withFixtureSchema(async () => {
      throw Error("must not enter");
    }),
  ).rejects.toThrow("Fixture DATABASE_URL is required");
  expect(fixtureDatabaseUrl({ databaseUrl: " postgresql://fixture/validated " })).toBe(
    "postgresql://fixture/validated",
  );
  expect(state.starts).toBe(0);
  expect(state.stops).toBe(0);
  expect(state.invocations).toBe(0);
  expect(state.statements).toEqual([]);
});

test("fixture owner returns successful work after observing clean stop", async () => {
  reset();
  const result = { owned: true };
  let work = 0;
  expect(
    await withFixtureSchema(
      async () => {
        work++;
        expect(state.stops).toBe(0);
        return result;
      },
      { databaseUrl: "postgres://fixture/db" },
    ),
  ).toBe(result);
  expect(work).toBe(1);
  assertOwnedWork();
});

for (const primary of [undefined, null, false, 0, "", new Error("original work failure")])
  for (const mode of ["primary-only", "both"] as const) {
    test(`fixture owner retains ${String(primary)} work identity with ${mode} cleanup`, async () => {
      reset();
      const cleanup = new Error("original cleanup failure");
      if (mode === "both") {
        state.stopMode = "throw";
        state.cleanup = cleanup;
      }
      let work = 0;
      const caught = await failure(() =>
        withFixtureSchema(
          async () => {
            work++;
            throw primary;
          },
          { databaseUrl: "postgres://fixture/db" },
        ),
      );
      expect(caught.failed).toBe(true);
      if (!caught.failed) throw Error("Expected original work failure");
      if (mode === "primary-only") expect(caught.error).toBe(primary);
      else {
        expect(caught.error).toBeInstanceOf(AggregateError);
        if (!(caught.error instanceof AggregateError))
          throw Error("Expected work/cleanup aggregate");
        const aggregate = caught.error;
        expect(aggregate.errors).toHaveLength(2);
        expect(aggregate.errors[0]).toBe(primary);
        expect(aggregate.errors[1]).toBe(cleanup);
      }
      expect(work).toBe(1);
      assertOwnedWork();
    });
  }
for (const mode of ["throw", "report"] as const)
  test(`fixture owner observes cleanup-only ${mode} without inventing work failure`, async () => {
    reset();
    state.stopMode = mode;
    const cleanup = new Error("cleanup only");
    const report = { successful: false, sentinel: { exact: true } };
    state.cleanup = cleanup;
    state.report = report;
    let work = 0;
    const caught = await failure(() =>
      withFixtureSchema(
        async () => {
          work++;
          return 42;
        },
        { databaseUrl: "postgres://fixture/db" },
      ),
    );
    expect(caught.failed).toBe(true);
    if (!caught.failed) throw Error("Expected cleanup failure");
    if (mode === "throw") expect(caught.error).toBe(cleanup);
    else {
      expect(caught.error).toBeInstanceOf(Error);
      if (!(caught.error instanceof Error)) throw Error("Expected unsuccessful-stop error");
      expect(caught.error.cause).toBe(report);
    }
    expect(work).toBe(1);
    assertOwnedWork();
  });
