import assert from "node:assert/strict";
import {
  authNeedsUsers,
  authUsesJwt,
  authUsesToken,
  htmlAuthKit,
  type StarterLayers,
} from "../../packages/strata-starter/src/types.ts";
import changes from "../fixtures/scaffolds/auth-password-login-delta.json";

type ChangeName = keyof typeof changes;

type ArtifactRoundTrip = { legacy: string | null; roundTrip: string | null };

/** Exact declared emitted-code delta, never whitespace/regex normalization. */
function passwordLoginArtifactRoundTrip(
  source: string | null,
  layers: StarterLayers,
): ArtifactRoundTrip {
  assert.equal(source !== null, authNeedsUsers(layers.auth));
  if (source === null) return { legacy: null, roundTrip: null };
  const cookie = htmlAuthKit(layers.auth);
  const bearer = authUsesToken(layers.auth) || authUsesJwt(layers.auth);
  const steps: Array<{ name: ChangeName; count: number }> = [
    { name: "import", count: 1 },
    { name: "operation", count: 1 },
    {
      name: "api",
      count:
        Number(authUsesToken(layers.auth)) +
        Number(authUsesJwt(layers.auth)) +
        Number(cookie && !bearer),
    },
    { name: cookie && layers.extras.mfa ? "browserMfa" : "browserPlain", count: Number(cookie) },
  ];
  const substitute = (input: string, name: ChangeName, count: number, reverse: boolean): string => {
    const entry = changes[name];
    const before = entry[reverse ? "after" : "before"].join("\n");
    const after = entry[reverse ? "before" : "after"].join("\n");
    assert.notEqual(before.length, 0);
    const parts = input.split(before);
    assert.equal(parts.length - 1, count, `Exact ${name} ${reverse ? "reverse" : "forward"} count`);
    return parts.join(after);
  };
  let legacy = source;
  for (const { name, count } of [...steps].reverse()) {
    legacy = substitute(legacy, name, count, true);
  }
  let roundTrip = legacy;
  for (const { name, count } of steps) {
    roundTrip = substitute(roundTrip, name, count, false);
  }
  assert.equal(roundTrip, source, "The complete current artifact must roundtrip byte-for-byte.");
  return { legacy, roundTrip };
}

export { passwordLoginArtifactRoundTrip };
