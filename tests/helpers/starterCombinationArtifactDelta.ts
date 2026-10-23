import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import delta from "../fixtures/scaffolds/starter-combination-corrections-delta.json";

type Artifact = { beforeSha256: string; afterSha256: string; hunks: string[] };
type Hunk = { before: string[]; after: string[] };
const artifacts: Readonly<Record<string, Artifact>> = delta.artifacts;
const hunks: Readonly<Record<string, Hunk>> = delta.hunks;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

function starterCombinationArtifactRoundTrip(
  namespace: "auth" | "starter",
  profile: string,
  path: string,
  source: string,
): { previous: string; roundTrip: string };
function starterCombinationArtifactRoundTrip(
  namespace: "auth" | "starter",
  profile: string,
  path: string,
  source: string | null,
): { previous: string | null; roundTrip: string | null };
/** Reviewed literal corrections; never normalize whitespace or regenerate a baseline in tests. */
function starterCombinationArtifactRoundTrip(
  namespace: "auth" | "starter",
  profile: string,
  path: string,
  source: string | null,
) {
  const key = `${namespace}/${profile}/${path}`;
  const artifact = artifacts[key];
  if (!artifact) return { previous: source, roundTrip: source };
  assert.notEqual(source, null, key);
  if (source === null) throw new Error(`Missing corrected artifact: ${key}`);
  assert.equal(digest(source), artifact.afterSha256, `Exact corrected bytes: ${key}`);
  const apply = (text: string, id: string, reverse: boolean): string => {
    const hunk = hunks[id];
    assert.ok(hunk, `Unknown declared hunk: ${id}`);
    const before = hunk[reverse ? "after" : "before"].join("\n");
    const after = hunk[reverse ? "before" : "after"].join("\n");
    assert.ok(before.length > 0);
    const parts = text.split(before);
    assert.equal(
      parts.length - 1,
      1,
      `Exact ${key}/${id} ${reverse ? "reverse" : "forward"} occurrence`,
    );
    return parts.join(after);
  };
  let previous = source;
  for (const id of [...artifact.hunks].reverse()) previous = apply(previous, id, true);
  assert.equal(digest(previous), artifact.beforeSha256, `Historical bytes: ${key}`);
  let roundTrip = previous;
  for (const id of artifact.hunks) roundTrip = apply(roundTrip, id, false);
  assert.equal(roundTrip, source, `Complete corrected artifact roundtrip: ${key}`);
  return { previous, roundTrip };
}

export { starterCombinationArtifactRoundTrip };
