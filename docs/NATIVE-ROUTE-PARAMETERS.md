# Native route parameter ownership

Bun owns URL decoding for parameters delivered to native route callbacks. Strata's
`routeParams` copies those values, and `toRouteRequest` attaches the copied map to
the same native request. Neither operation decodes a parameter again. Repeated
adaptation must preserve the value, request identity and Bun transport internals.

## Confirmed defect and correction

On exact published 2.2.52 with official native Bun 1.4.3, a request containing
`/items/100%25` reaches Bun's callback with `id: "100%"`. The adapter's second
`decodeURIComponent` throws, producing a 500. `/items/%252F` reaches Bun with
`id: "%2F"`, but the adapter substitutes `"/"` before a secured string-key model
lookup. These are confirmed defects, not compatibility behavior to preserve.
ASCII, accented text and an encoded slash provide independent controls.

The compatible correction removes the second decode in the existing adapter.
String coercion, absent-parameter behavior, helper exports, native request identity,
secured binding and authorization ownership remain. It introduces no router, path
parser, application workaround or new major API. A custom request producer must
supply parameter values in the same already-decoded form as Bun; an encoded URL
substring is not a decoded parameter map. This correction does not change URL
decoding for static filesystem paths.

## Regression evidence and limits

The real HTTP tests retain all previous assertions and add seven native parameter
controls: ASCII, accented text, a trailing percent sign, an encoded-looking slash,
an encoded slash, an encoded-looking percent sign and an encoded-looking malformed
escape. They compare Bun's value with `routeParams`, first adaptation and repeated
adaptation. Secured string-key binding separately verifies the value given to its
resolver. The installed native-route consumer exercises the same controls through
`createWebServer` after the original repository, admission, method and CSRF checks.

The original published-package probe failed four of seven controls. The source
regressions also failed before the correction. The first new installed fixture
incorrectly compared Bun's `RequestParams` prototype with a plain object; that
fixture failure is retained separately. Its corrected comparison verifies the
unchanged native map identity and every copied field before adaptation. The
corrected fixture then reproduces the published adapter's percent-sign failure.

Raw evidence is retained in `/tmp/strata-m1-http-contracts-20261023`, including
the exact published consumer lockfile, native control, source red/green logs and
both installed-fixture attempts. This evidence is bounded to the pinned runtime;
it does not qualify Bun 1.4.4, opaque asset transport or mixed WebSocket draining.
The M1 type proposal must reuse the native parameter contract rather than freeze
this defect or add another decoding layer.

See [Bun's native routing contract](https://bun.sh/docs/runtime/http/routing).
Shop adoption remains manually held for #257 and the timer remains off.

## Published 2.2.53 acceptance

The compatible correction is published in all five aligned 2.2.53 packages after
actual merged-main CI/security and the full trusted release workflow succeeded.
All 159 established published profiles executed and passed, with no failures/skips;
the native-route profile executes all seven percent/encoding controls after every
original assertion. Twelve 2.2.52→2.2.53→2.2.52 upgrade/exact-lock rollback profiles
also pass, retaining source/build/dependency snapshots and committed data.

The source gate passes 2,716 tests with three unchanged exclusions and 191 E2E
without failures/skips; actual Linux release CI passes 2,717 with two existing
exclusions and 191 E2E. Complete captured SQL/Docker metadata and exact owned Redis
and UUID scratch baselines are restored. The [sanitized receipt](qualification/native-route-2.2.53.json)
keeps identities and input/log hashes; all older failed evidence remains unchanged.
This is pinned native Bun 1.4.3 evidence, not qualification of 1.4.4 or a waiver of
the manual #257 shop hold. The timer stays off.

## Own-property copy defect found during M1 feasibility

The native parameter-name probe confirmed another defect on published 2.2.53.
For `/keys/:__proto__`, Bun supplies an own string value, but assigning it onto an
ordinary `{}` invokes the legacy `Object.prototype.__proto__` setter and drops the
key. Repeated route adaptation therefore loses a value present in the native map.
The `constructor` control remains an own value. The observed failure is parameter
loss; these string-value probes do not establish prototype pollution.

The compatible source correction creates own data properties with
`Object.fromEntries` while retaining the ordinary object prototype, string coercion,
Bun-owned decoding and native request identity. It introduces no null-prototype map,
new API, reserved-name ban or route parser. Original unit and installed-consumer
bodies remain byte-identical prefixes; appended real-native assertions fail first
on original source and exact published 2.2.53, then pass on the correction and a
freshly built installed candidate.

**This own-property correction is source-only until a later qualified patch release.**
The earlier 159-profile 2.2.53 acceptance remains immutable bounded evidence; it
does not assert every parameter name was tested. The M1 proposal records this as a
confirmed defect, separately from compatibility guarantees and native feasibility
observations. Raw red/green and fixture setup logs are retained under
`/tmp/strata-m1-path-method-feasibility-20261024`. No new version/tag is prepared
for this design continuation. Shop adoption stays held for #257; timer stays off.
