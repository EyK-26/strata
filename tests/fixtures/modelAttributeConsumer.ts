/** Installed consumer of the existing public Model attribute exports. */
import assert from "node:assert/strict";
import { verifyPassword } from "@getstrata/core/auth/password";
import {
  applyCasts,
  dehydrateValue,
  filterMassAssignable,
  hydrateValue,
} from "@getstrata/core/database/model";

for (const value of [null, undefined]) {
  assert.equal(hydrateValue(value, "json"), value);
  assert.equal(dehydrateValue(value, "json"), value);
  assert.equal(await dehydrateValue(value, "hashed"), value);
}
const date = new Date("2026-01-02T03:04:05Z");
for (const cast of ["date", "datetime"] as const) {
  assert.equal(hydrateValue(date, cast), date);
  assert.equal(dehydrateValue(date, cast), date);
  assert.deepEqual(hydrateValue(date.toISOString(), cast), date);
  assert.deepEqual(dehydrateValue(date.toISOString(), cast), date);
}
const data = { count: 2 };
assert.equal(hydrateValue(data, "json"), data);
assert.deepEqual(hydrateValue(JSON.stringify(data), "json"), data);
assert.equal(dehydrateValue(data, "json"), JSON.stringify(data));
assert.equal(dehydrateValue(JSON.stringify(data), "json"), JSON.stringify(data));
assert.equal(hydrateValue("existing-password-value", "hashed"), "existing-password-value");
for (const cast of ["int", "integer"] as const) {
  assert.equal(hydrateValue("", cast), null);
  assert.equal(dehydrateValue("", cast), null);
  assert.equal(hydrateValue("42", cast), 42);
  assert.equal(dehydrateValue("42", cast), 42);
}
for (const cast of ["bool", "boolean"] as const) {
  for (const value of [true, 1, "1", "true"]) assert.equal(hydrateValue(value, cast), true);
  for (const value of [false, 0, "0", "false"]) assert.equal(hydrateValue(value, cast), false);
  assert.equal(dehydrateValue("false", cast), true);
  assert.equal(dehydrateValue(0, cast), false);
}
// Preserve the JavaScript caller boundary without widening the public CastType union.
assert.equal(Reflect.apply(hydrateValue, undefined, [data, "unrecognized"]), data);
assert.equal(Reflect.apply(dehydrateValue, undefined, [data, "unrecognized"]), data);

const input = { id: 1, count: "2" };
assert.equal(applyCasts(input, {}, "hydrate"), input);
assert.equal(await applyCasts(input, {}, "dehydrate"), input);
const casts = { count: "int", absent: "json", unspecified: undefined } as const;
assert.deepEqual(applyCasts(input, casts, "hydrate"), { id: 1, count: 2 });
assert.deepEqual(await applyCasts(input, casts, "dehydrate"), { id: 1, count: 2 });
assert.deepEqual(input, { id: 1, count: "2" });

const assignment = { name: "Example", is_admin: true };
assert.deepEqual(filterMassAssignable(["name"], undefined, assignment), { name: "Example" });
assert.deepEqual(filterMassAssignable(undefined, ["is_admin"], assignment), { name: "Example" });
assert.deepEqual(filterMassAssignable(undefined, [], assignment), assignment);
assert.deepEqual(filterMassAssignable(undefined, true, assignment), {});
assert.deepEqual(filterMassAssignable(undefined, ["*"], assignment), {});
assert.deepEqual(filterMassAssignable(undefined, undefined, {}), {});
assert.throws(
  () => filterMassAssignable(undefined, undefined, assignment),
  /Mass assignment is not configured for this model/,
);
assert.deepEqual(assignment, { name: "Example", is_admin: true });

const plain = "qualification-model-attribute-password";
const hash = await dehydrateValue(plain, "hashed");
assert.equal(typeof hash, "string");
assert.ok(typeof hash === "string" && (await verifyPassword(plain, hash)));
assert.notEqual(hash, plain);
assert.equal(await dehydrateValue(hash, "hashed"), hash);
const hashed = await applyCasts(
  { secret: plain, nullable: null },
  { secret: "hashed", nullable: "hashed", absent: "hashed" },
  "dehydrate",
);
assert.ok(typeof hashed.secret === "string" && (await verifyPassword(plain, hashed.secret)));
assert.equal(hashed.nullable, null);
assert.equal(Object.hasOwn(hashed, "absent"), false);

console.log(
  "PASS installed public Model casts, mass assignment, async hashes and import contracts",
);
