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
