import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { isUniqueConstraintError, PersistenceError } from "@getstrata/core/database/errors";
import { ConflictError } from "@getstrata/core/errors/http";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import * as auth from "../../../packages/strata-starter/src/renderAuth.ts";
import * as flows from "../../../packages/strata-starter/src/renderAuthFlows.ts";
import currentModules from "../../fixtures/scaffolds/auth-password-operation-current.sha256.json";
import baselines from "../../fixtures/scaffolds/auth-rendering.sha256.json";
import { passwordLoginArtifactRoundTrip } from "../../helpers/authLoginArtifactDelta.ts";
import { starterCombinationArtifactRoundTrip } from "../../helpers/starterCombinationArtifactDelta.ts";

const currentModuleHashes: Readonly<Record<string, string | null>> = currentModules;

// Historical 2.2.48 whole-artifact hashes stay unchanged. The separately declared
// emitted password-operation refactor has exact literal substitution counts and
// a byte-for-byte forward/reverse roundtrip, plus strict CURRENT module hashes.
// No whitespace or regex normalization; installed auth journeys remain the
// runtime authority for SMTP, MFA, replay, contention and credential revocation.
for (const { name, args, hashes } of baselines) {
  test(`auth rendering preserves the pre-extraction artifacts: ${name}`, () => {
    const layers = layersFromFlags(parseCreateStrataArgs(args));
    const current = auth.renderAuthModule(layers);
    const correction = starterCombinationArtifactRoundTrip(
      "auth",
      name,
      "src/modules/auth/index.ts",
      current,
    );
    expect(correction.roundTrip).toBe(current);
    const module = correction.previous;
    const { legacy, roundTrip } = passwordLoginArtifactRoundTrip(module, layers);
    expect(roundTrip).toBe(module);
    const currentHash = currentModuleHashes[name];
    if (currentHash === undefined) throw new Error(`Missing current artifact hash: ${name}`);
    expect(module === null ? null : createHash("sha256").update(module).digest("hex")).toBe(
      currentHash,
    );
    const artifacts = {
      module: legacy,
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

test("legacy auth imports retain the same flow function identities", () => {
  expect(auth.renderAuthModule).toBe(flows.renderAuthModule);
  expect(auth.renderPendingMfaTs).toBe(flows.renderPendingMfaTs);
  expect(auth.renderSiteModule).toBe(flows.renderSiteModule);
});

test("current password-operation artifact inventory retains every historical profile", () => {
  expect(Object.keys(currentModules).sort()).toEqual(baselines.map(({ name }) => name).sort());
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
    "if (!isUniqueConstraintError(error) || !(await starterAuthDirectory.findByEmail(email))) throw error;",
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
  const createRegistration = new Function(
    "runAuthWrite",
    "runInTransaction",
    "User",
    "starterAuthDirectory",
    "isUniqueConstraintError",
    `${javascript}\nreturn createRegistration;`,
  )(
    (_identifier: unknown, work: () => Promise<unknown>) => work(),
    (work: () => Promise<unknown>) => work(),
    {
      create: async () => {
        throw failure;
      },
    },
    {
      findByEmail: async () => {
        readbacks++;
        return accountExists ? { id: 1 } : null;
      },
    },
    isUniqueConstraintError,
  ) as (credentials: { name: string; email: string; password: string }) => Promise<unknown>;
  const outcome = await createRegistration({
    name: "Account",
    email: "account@example.test",
    password: "password",
  }).then(
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
