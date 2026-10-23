# Starter combination corrections for 2.2.52

Nine reports (#337–#345) reproduced independently against exact published 2.2.51.
The relevant runtime paths also matched 2.2.50; this is not an earliest-introduction
bisect. The earlier 134-profile qualification remains a dated receipt, rather than
a guarantee for every combination of optional features.

## Confirmed defects and corrections

- Offset pagination omitted eager attachment although ordinary and keyset reads
  attached it. Offset pages now retain relation data and pagination metadata.
- To-many eager limits applied to the whole parent batch. Limited has-many,
  polymorphic-many, through and pivot reads now use SQL window bounds per owner,
  preserving filters, soft-delete policy, ordering and custom repository dispatch.
  Equal sort values use the primary key as a stable tie-breaker. Grouped, HAVING
  and locked limited eager reads fail explicitly; they have no supported bounded
  relationship interpretation. Unsafe bounds and internal rank alias collisions
  also fail explicitly. No unbounded JavaScript slicing or per-parent query loop
  substitutes for database bounds.
- Static create inserted its original payload after observers edited a separate
  pending model. Initial write casts still resolve before saving/creating
  observers, preserving the existing password-hash contract. Only observer-edited
  fields receive a subsequent write transformation before insertion; unchanged
  fields are not cast twice. Cancellation prevents insertion and any subsequent
  edit transformation; trusted forced attributes retain priority.
  Framework-owned merges preserve immutable results returned by custom write hooks.
- Invalidating array-cache keys, prefixes, tags or the whole store did not revoke
  pending loaders. Retired callers may receive their own result, but cannot
  republish it or remove the ownership of a replacement fill.
- Response middleware and request logging generated different correlation IDs.
  They now resolve one ID through the request context, including both middleware
  orders, incoming IDs, failures and concurrent requests.
- Built SPA/hybrid documents and missing-build responses bypassed configured
  security headers and observation. Generated composition now explicitly applies
  the kernel's shared response policies without requiring authentication or tenant
  services for public documents.
- Cookie-auth API/SPA applications could redirect browser SSO into a missing MFA
  challenge. They now reuse the existing challenge renderer with CSRF and throttle
  composition, without enabling the general web login/register routes. Pending
  sessions remain unauthenticated until a valid factor is submitted.
- Generated webhook jobs swallowed delivery failures and always recorded attempt
  one. Transport and every non-2xx response now enter the selected queue's bounded
  retry policy. Response bodies are explicitly cancelled when only status is
  needed. Delivery and recording failures remain inspectable together.
- Generated webhook listeners ignored subscriptions. Only an active literal event
  match or explicit `*` receives an event. Other subscription representations are
  not interpreted as wildcard subscriptions.

The retry acceptance also exposed a separate persistence defect: the failed-job
repository passed logical JSON objects and Date values straight to SQLite. The
repository now owns JSON/timestamp storage mapping and restores logical payloads
and Dates for list/replay callbacks across supported SQL drivers. Admission still
precedes deletion of the recovery record. Hydration preserves selected-column
projections without adding absent payload/timestamp fields. Queue leases, wire
envelopes and the at-least-once delivery contract are unchanged.

## Validation and limits

Committed regressions cover native SQLite, observer/cast ordering, cancellation,
forced fields, cache fill ownership, correlation and bounded relation scopes and
query counts. The installed-consumer matrix contains 24 profiles: three ORM,
nine signed OIDC/MFA, six built frontend/HTTP and six synchronous/Redis webhook
profiles across SQLite, MySQL and Postgres. The matrix and full mandatory gate
must pass on the final release tree. Exact-published 2.2.52 qualification and
resource restoration are pending; no publication acceptance is claimed here.
Historical assertions, skips, coverage boundaries and failed logs are retained.
The historical generator hash manifests are unchanged. Eleven reviewed literal
text changes have exact before/after hashes, occurrence checks and a complete
forward/reverse byte roundtrip for twenty corrected artifacts; all other bytes
still compare directly with their historical baseline. An early candidate that
ran observers before initial hashes failed three existing contracts and was
corrected before publication, without changing those assertions.

The OIDC journey validates real state/PKCE/nonce/JWKS exchanges, registration,
enrollment, rejected factors, CSRF rejection and final authentication. This is
not provider-specific production qualification for every other SSO provider.
Webhook tests retain transient, terminal, transport, recording, event selection
and transaction rollback assertions on both transports, plus durable failure
records. Application delivery is still at least once; receivers must deduplicate.

## Existing applications and the accepted plan

A dependency upgrade cannot rewrite customized generated sources. Adopt changes
in bootstrap composition, auth routes/imports, the outbound webhook job and its
listener deliberately, preserving application-specific edits. Compare a fresh
2.2.52 app with the same choices and use the framework APIs/ORM; do not patch
installed packages or add alternate application mechanisms to mask these defects.

These corrections do not change the accepted major-version design decisions.
Native opaque assets still target an explicit public artifact origin in the
major-version plan. Native Bun pipeline delivery and mixed HTTP/WebSocket abort
reporting limitations remain recorded separately. API/provider/browser,
migration, deprecation and rollback acceptance for that design remain open.
Shop adoption stays manually **held for #257**, independently of issue closure or
new Bun releases. The implementation timer remains **off**.
