import assert from "node:assert/strict";
import * as m1 from "@getstrata/bootstrap/m1";

const approved = [
  "collectPublicArtifactManifest",
  "createPublicArtifactResolver",
  "defineApplicationRoutes",
  "describeM1Failure",
  "getM1StartupCleanupCompletion",
  "M1ConfigurationError",
  "prepareDocumentArtifacts",
  "startGuardedApplication",
  "verifyPublicArtifactFiles",
].sort();
assert.deepEqual(Object.keys(m1).sort(), approved);
for (const name of ["HTTP_METHODS", "routeShape", "validateGuardedRoutes"])
  assert.equal(Object.hasOwn(m1, name), false, `${name} must remain internal.`);
for (const name of approved)
  assert.equal(typeof m1[name as keyof typeof m1], "function", `${name} must remain available.`);
assert.equal(m1.M1ConfigurationError.prototype instanceof TypeError, true);
console.log(JSON.stringify({ contract: "packed-m1-exports", passed: true, exports: approved }));
