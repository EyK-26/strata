import { expect, test } from "bun:test";
import { describeM1Failure, recordM1Diagnostic } from "../../src/bootstrap/m1/diagnostics";
import { validateGuardedRoutes } from "../../src/bootstrap/m1/guardedRoutes";
import { M1ConfigurationError } from "../../src/bootstrap/m1/validation";

test("checked declarations report bounded stage, code, field, owner and migration guidance", () => {
  let failure: unknown;
  try {
    validateGuardedRoutes({ "/private": Bun.file("private-do-not-emit") }, "api:reports");
  } catch (error) {
    failure = error;
  }
  const info = describeM1Failure(failure);
  expect(info.stage).toBe("validation");
  expect(info.code).toBe("invalid-record");
  expect(info.field).toBe("methods");
  expect(info.owner).toBe("api:reports");
  expect(info.hint).toContain("guarded file Response");
  expect(JSON.stringify(info)).not.toContain("private-do-not-emit");
  expect(Object.isFrozen(info)).toBe(true);
});
test("orchestration annotations preserve primary error identity and never copy its message", () => {
  const original = new Error("/private/path?password=owned-fixture");
  recordM1Diagnostic(original, {
    stage: "publication",
    code: "metadata-publication-failed",
    field: "routes",
    owner: "api:reports",
  });
  expect(describeM1Failure(original)).toEqual({
    stage: "publication",
    code: "metadata-publication-failed",
    field: "routes",
    owner: "api:reports",
  });
  expect(original.message).toContain("password=");
  expect(JSON.stringify(describeM1Failure(original))).not.toContain("password=");
  recordM1Diagnostic(original, { stage: "bind", code: "http-bind-failed", field: "transport" });
  expect(describeM1Failure(original).stage).toBe("bind");
});
test("specific configuration details survive phase annotation and mutable Error properties", () => {
  const error = new M1ConfigurationError("missing-document-capability", "documents", "web:pages");
  Object.assign(error, {
    code: "raw-secret",
    field: "/private/path",
    owner: "https://user:secret@host",
  });
  recordM1Diagnostic(error, {
    stage: "collection",
    code: "route-collection-failed",
    field: "routes",
  });
  expect(describeM1Failure(error)).toEqual({
    stage: "collection",
    code: "missing-document-capability",
    field: "documents",
    owner: "web:pages",
  });
});
test("unknown and malformed errors cannot execute accessors or leak raw values", () => {
  let reads = 0;
  const fake = Object.defineProperty({}, "message", {
    get() {
      reads++;
      return "secret";
    },
  });
  for (const value of [undefined, null, "raw-secret", 7, fake]) {
    expect(describeM1Failure(value)).toEqual({
      stage: "startup",
      code: "startup-failed",
      field: "application",
    });
    recordM1Diagnostic(value, {
      stage: "bind",
      code: "bad?secret",
      field: "/private/file",
      owner: "https://user:secret@host",
    });
  }
  expect(reads).toBe(0);
  expect(describeM1Failure(fake)).toEqual({
    stage: "bind",
    code: "startup-failed",
    field: "application",
  });
});

test("an untyped diagnostic stage is never reflected into the safe output", () => {
  const error = new M1ConfigurationError(
    "unsafe/path",
    "/private/path",
    "https://user:secret@host",
    "private-stage" as never,
  );
  expect(describeM1Failure(error)).toEqual({
    stage: "startup",
    code: "startup-failed",
    field: "application",
  });
});
