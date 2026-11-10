import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import delta from "../fixtures/scaffolds/starter-combination-corrections-delta.json";

type Artifact = { beforeSha256: string; afterSha256: string; hunks: string[] };
type Hunk = { before: string[]; after: string[] };
const artifacts: Readonly<Record<string, Artifact>> = delta.artifacts;
const hunks: Readonly<Record<string, Hunk>> = delta.hunks;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

// M3a's neutral database errors change exactly this import and signup race predicate.
// Reverse those two reviewed literals before the existing full-artifact hash proof;
// reapply both afterward so historical byte hashes and current bytes stay checked.
function uniqueSignupDelta(source: string, key: string) {
  const importAnchor = 'import { ConflictError } from "@getstrata/core/errors/http";';
  const classifierImport =
    'import { isUniqueConstraintError } from "@getstrata/core/database/errors";';
  const previousPredicate =
    "if (!(error instanceof ConflictError) || !(await starterAuthDirectory.findByEmail(email))) throw error;";
  const currentPredicate =
    "if (!isUniqueConstraintError(error) || !(await starterAuthDirectory.findByEmail(email))) throw error;";
  const replace = (text: string, before: string, after: string) => {
    const parts = text.split(before);
    assert.equal(parts.length - 1, 1, `Exact neutral signup delta occurrence: ${key}/${before}`);
    return parts.join(after);
  };
  const forward = (text: string) =>
    replace(
      replace(text, importAnchor, `${importAnchor}\n${classifierImport}`),
      previousPredicate,
      currentPredicate,
    );
  const previous = replace(
    replace(source, `${importAnchor}\n${classifierImport}`, importAnchor),
    currentPredicate,
    previousPredicate,
  );
  assert.equal(forward(previous), source, `Exact neutral signup delta roundtrip: ${key}`);
  return { previous, forward };
}

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
  const signup =
    path === "src/modules/auth/index.ts" && source !== null
      ? uniqueSignupDelta(source, key)
      : undefined;
  const corrected = signup?.previous ?? source;
  const artifact = artifacts[key];
  if (!artifact) return { previous: corrected, roundTrip: source };
  assert.notEqual(corrected, null, key);
  if (corrected === null) throw new Error(`Missing corrected artifact: ${key}`);
  assert.equal(digest(corrected), artifact.afterSha256, `Exact corrected bytes: ${key}`);
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
  let previous = corrected;
  for (const id of [...artifact.hunks].reverse()) previous = apply(previous, id, true);
  assert.equal(digest(previous), artifact.beforeSha256, `Historical bytes: ${key}`);
  let roundTrip = previous;
  for (const id of artifact.hunks) roundTrip = apply(roundTrip, id, false);
  assert.equal(roundTrip, corrected, `Complete corrected artifact roundtrip: ${key}`);
  if (signup) roundTrip = signup.forward(roundTrip);
  assert.equal(roundTrip, source, `Complete current artifact roundtrip: ${key}`);
  return { previous, roundTrip };
}

export { starterCombinationArtifactRoundTrip };
