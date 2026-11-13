import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { isUniqueConstraintError, PersistenceError } from "@getstrata/core/database/errors";
import { ConflictError } from "@getstrata/core/errors/http";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import * as auth from "../../../packages/strata-starter/src/renderAuth.ts";
import historical from "../../fixtures/scaffolds/auth-rendering.sha256.json";
import baselines from "../../fixtures/scaffolds/auth-rendering-canonical.sha256.json";

// Hash the complete emitted artifact, without rewrites or normalization. Historical
// snapshots remain as an inventory and migration record, not an old-API requirement.
for (const { name, args, hashes } of baselines) {
  test(`auth rendering matches canonical full artifacts: ${name}`, () => {
    const layers = layersFromFlags(parseCreateStrataArgs(args));
    const artifacts = {
      module: auth.renderAuthModule(layers),
      directory: auth.renderAuthDirectory(layers),
      provider: auth.renderAuthProvider(layers),
      pendingMfa: auth.renderPendingMfaTs(),
      site: auth.renderSiteModule(layers),
    };
    const actual = Object.fromEntries(
      Object.entries(artifacts).map(([artifact, source]) => [
        artifact,
        source === null ? null : createHash("sha256").update(source).digest("hex"),
      ]),
    );
    expect(actual).toEqual(hashes);
  });
}

test("canonical auth artifact inventory retains the 64 existing profiles", () => {
  expect(baselines).toHaveLength(64);
  expect(baselines.map(({ name, args }) => ({ name, args }))).toEqual(
    historical.map(({ name, args }) => ({ name, args })),
  );
});

function renderedSignup() {
  const layers = layersFromFlags(
    parseCreateStrataArgs([
      "--frontend=api",
      "--auth=token",
      "--database=sqlite",
      "--tenancy=none",
    ]),
  );
  const source = auth.renderAuthModule(layers);
  if (source === null) throw new Error("Missing generated signup module");
  return source;
}

test("generated signup imports the neutral unique classifier and preserves domain conflicts", () => {
  const source = renderedSignup();
  expect(source).toContain(
    'import { isUniqueConstraintError } from "@getstrata/core/database/errors";',
  );
  expect(source).toContain(
    "if (!isUniqueConstraintError(error) || !(await createStarterAuthDirectory(ports).findByEmail(email))) throw error;",
  );
  expect(source).not.toContain("if (!(error instanceof ConflictError)");
  const profile = baselines.find(
    ({ args }) => args.includes("--mfa") && args.includes("--auth=cookie"),
  );
  if (!profile) throw new Error("Missing MFA rendering profile");
  expect(auth.renderAuthModule(layersFromFlags(parseCreateStrataArgs(profile.args)))).toContain(
    'throw new ConflictError("MFA configuration changed. Reload and confirm again.")',
  );
});

async function invokeRenderedSignup(failure: unknown, accountExists: boolean) {
  const source = renderedSignup();
  const start = source.indexOf("async function createRegistration(");
  const end = source.indexOf("\nasync function consumeSignedAuthToken", start);
  if (start < 0 || end < 0) throw new Error("Missing generated registration function boundaries");
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end));
  let readbacks = 0;
  const userDefinition = Symbol("User definition");
  let inTransaction = false;
  const transactionPorts = {
    database: {
      model(definition: unknown) {
        expect(definition).toBe(userDefinition);
        expect(inTransaction).toBe(true);
        return {
          create: async () => {
            throw failure;
          },
        };
      },
    },
  };
  const ports = {
    database: {
      model() {
        throw new Error("Registration writes must use the selected child transaction");
      },
    },
  };
  const createRegistration = new Function(
    "runAuthWrite",
    "runAuthTransaction",
    "User",
    "createStarterAuthDirectory",
    "isUniqueConstraintError",
    `${javascript}\nreturn createRegistration;`,
  )(
    (selected: object, identifier: string, work: (ports: object) => Promise<unknown>) => {
      expect(selected).toBe(ports);
      expect(identifier).toBe("account@example.test");
      return work(selected);
    },
    async (selected: object, work: (ports: object) => Promise<unknown>) => {
      expect(selected).toBe(ports);
      inTransaction = true;
      try {
        return await work(transactionPorts);
      } finally {
        inTransaction = false;
      }
    },
    userDefinition,
    (selected: object) => {
      expect(selected).toBe(ports);
      return {
        findByEmail: async (email: string) => {
          expect(email).toBe("account@example.test");
          expect(inTransaction).toBe(false);
          readbacks++;
          return accountExists ? { id: 1 } : null;
        },
      };
    },
    isUniqueConstraintError,
  ) as (
    ports: object,
    services: object,
    credentials: { name: string; email: string; password: string },
  ) => Promise<unknown>;
  const outcome = await createRegistration(
    ports,
    {},
    {
      name: "Account",
      email: "account@example.test",
      password: "password",
    },
  ).then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  return { outcome, readbacks };
}

for (const accountExists of [true, false]) {
  test(`generated signup neutralizes a unique failure only with account readback: ${accountExists}`, async () => {
    const failure = new PersistenceError("DATABASE_UNIQUE_CONSTRAINT");
    const { outcome, readbacks } = await invokeRenderedSignup(failure, accountExists);
    expect(readbacks).toBe(1);
    if (accountExists) expect(outcome).toEqual({ ok: true, value: undefined });
    else {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toBe(failure);
    }
  });
}

for (const [name, failure] of [
  ["nonunique persistence", new PersistenceError("DATABASE_NOT_NULL_CONSTRAINT")],
  ["domain conflict", new ConflictError("Account conflict")],
  ["unrelated opaque", Symbol("unrelated")],
] as const) {
  test(`generated signup propagates ${name} failure without account readback`, async () => {
    const { outcome, readbacks } = await invokeRenderedSignup(failure, true);
    expect(readbacks).toBe(0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe(failure);
  });
}
