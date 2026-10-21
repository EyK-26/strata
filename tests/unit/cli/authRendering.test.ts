import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import * as auth from "../../../packages/strata-starter/src/renderAuth.ts";
import * as flows from "../../../packages/strata-starter/src/renderAuthFlows.ts";
import baselines from "../../fixtures/scaffolds/auth-rendering.sha256.json";

// Captured from released 2.2.48 before moving renderer source. Hash complete
// artifacts without normalization; existing installed auth journeys remain the
// runtime authority for SMTP, MFA, replay, contention and credential revocation.
for (const { name, args, hashes } of baselines) {
  test(`auth rendering preserves the pre-extraction artifacts: ${name}`, () => {
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

test("legacy auth imports retain the same flow function identities", () => {
  expect(auth.renderAuthModule).toBe(flows.renderAuthModule);
  expect(auth.renderPendingMfaTs).toBe(flows.renderPendingMfaTs);
  expect(auth.renderSiteModule).toBe(flows.renderSiteModule);
});
