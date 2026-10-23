import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
