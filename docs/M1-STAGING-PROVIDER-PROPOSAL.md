# M1 staging public-artifact delivery proposal

26 October 2026 — proposal for human review, **no resources deployed or configured**.
This follows the user's choice to prepare a proposal rather than use an existing
provider or publish a staging service. Actual hosted qualification remains pending.

## Proposed first option

Use a dedicated staging S3 bucket with a public CloudFront artifact hostname,
origin access control and a separate, narrowly scoped upload identity. Keep S3
private; the reviewed objects are intentionally public through the distribution.
Use the normal S3 bucket origin, not an S3 website endpoint. AWS documents the
different HTTPS behavior and OAC choices for those origin types.
[AWS origin HTTPS documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-https-cloudfront-to-s3-origin.html).

This is a proposed configuration, not a claim that an AWS account, domain,
distribution or budget already exists. If the organization already uses Cloudflare
R2 and manages the appropriate DNS zone there, R2 with a custom domain is a sensible
alternative to review rather than introducing AWS solely for this experiment.
R2's managed development URL is rate limited/non-production; a custom domain is
the documented route for caching and the relevant edge controls.
[R2 public bucket documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

Do not add a generic publisher interface or deployment framework to Strata. Use the
selected provider's supported CLI/SDK in an operator-owned release step. Application
startup only selects a previously verified immutable manifest and document plan.
The existing storage/driver abstractions remain in place.

## Boundaries that must be accepted

- The artifact hostname is public. It cannot promise app auth, tenant context,
  per-request app denial, app request IDs or ORM access. Private documents,
  protected downloads, API responses and source maps remain outside the public list.
- Use a genuinely isolated cookie scope. Prefer a separate registrable artifact
  domain if application cookies may cover sibling subdomains. A different port is
  not cookie isolation. DNS ownership, HTTPS certificates and the actual app cookie
  policy need explicit review before selecting real hostnames.
- Guarded HTML still comes from the app and the real renderer, with its CSP nonce,
  complete supported module integrity map before module requests, and anonymous
  script/style resource attributes. Imported native HTML bundles are not silently
  made public or rewritten to manufacture those guarantees.
- Keep the app's `APP_URL`, host admission and configured CSRF target-origin contract.
  Asset delivery does not replace or loosen those controls. No forwarded-header
  trust or arbitrary app-origin acceptance is introduced.

## S3/CloudFront staging configuration to review

1. A bucket/delivery origin dedicated to this staging exercise. Block direct public
   S3 access, scope distribution access through OAC, and keep provider administration
   credentials out of the application runtime. Select region, ownership and DNS
   management with the operator before provisioning.
2. HTTPS viewer access and HTTPS origin communication under the chosen OAC settings.
   Permit only the required viewer methods (GET/HEAD and OPTIONS if needed).
3. No cookies or Authorization forwarded to storage. Do not vary the object cache
   on credentials. Redact credentials from provider logs and never set app session
   cookies on asset responses. Verify this at the actual edge and origin.
4. An explicit staging app-origin CORS allowlist, no credentialed CORS, correct
   origin-aware caching where responses vary, content types and `nosniff`. Configure
   and test the cache policy and response-header policy together. CloudFront provides
   response-header policies and documents which request headers need forwarding for
   S3 CORS; configuring only the bucket is insufficient evidence.
   [Response policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/modifying-response-headers.html),
   [CORS/cache keys](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html).
5. A unique immutable release prefix such as `/releases/<build-id>/`. No minification,
   code rewriting or unreviewed redirect is allowed. Compression may be tested as
   a transport representation, with stored bytes and decoded delivered bytes checked
   separately. Content-hashed/versioned objects can use an explicitly reviewed long
   public cache lifetime; guarded HTML keeps its own cache policy.
6. Upload permission limited to this bucket and release-prefix scope. Read/list
   permission is limited to verification requirements. Any cleanup permission is
   constrained to receipted objects from this job, never broad bucket deletion.
   Use conditional creation to prevent overwriting an existing key. S3 documents
   `If-None-Match` conditional writes and the conflict/precondition responses;
   these are not an automatic all-release retry certificate.
   [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

## Publication protocol

1. Capture the explicitly selected native outputs under producer ownership; retain
   the manifest, source/lock/build identity, safe document plan and known graph scope.
2. Verify retained files before upload. Do not recapture changed files and describe
   that as verification against the original build.
3. Record the precise prefix and object keys owned by the attempt before writing.
   Create immutable keys conditionally. Existing objects are a collision requiring
   explicit ownership/digest review, not permission to overwrite them.
4. Verify storage object bytes/lengths, metadata and every selected edge-visible
   object over validated HTTPS. Compare actual decoded delivered bytes with the
   retained manifest. Treat ETag as an opaque protocol value, not a substitute for
   the manifest's SHA-256.
5. Run the browser/transport checks below before selecting that build in guarded
   HTML. Only a completely verified release becomes selectable. A partial upload
   must leave the previous selection unchanged.
6. On failure, retain the primary failure and cleanup receipt separately. Delete
   only objects proven created/owned by this attempt. Do not infer all cleanup from
   a single successful deletion or retry an unconfirmed operation blindly.

## Hosted acceptance matrix

All of these require the actual approved provider/origin; local nginx or a URL map
does not satisfy them:

- Valid HTTPS and certificate chain; bad-host/certificate controls; HTTP policy;
  app host/CSRF admission unaffected by TLS offload.
- Actual MIME, byte count and SHA-256; JS/CSS execution under CSP; wrong/tampered bytes
  rejected where the declared browser/resource contract requires integrity.
- Approved/unapproved Origin, CORS preflights, cache variation and no credential
  forwarding/set-cookie. Inspect both app and provider observations.
- GET/HEAD, byte and invalid ranges, conditional requests, missing objects, unsupported
  methods, interrupted/large transfers, compression and redirect behavior.
- Failed/partial upload, concurrent key collision, verification failure, and cleanup
  failure. The old selected manifest/document must remain usable throughout.
- Old A client, new B client, A→B→A selection rollback and old deferred A/B assets.
  Retain complete supported release graphs; never retire them merely by object age.
- Safe provider logs and operator-visible failures without inventing app per-request
  auth/tenant/tracing measurements for public delivery.

## R2 alternative: conditions to review

Use an R2 custom domain in the account that owns the DNS zone. Review cache and
header behavior at that domain, not the development endpoint. CORS responses require
the actual request Origin; policy changes can require cache invalidation before
cached responses reflect them. Preserve the same immutable-key, verification,
credential-isolation and retention protocol; do not assume S3 compatibility means
all S3 conditional/header behavior is already qualified.
[R2 CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

## Inputs and approvals still needed

- Delivery owner/account, region, staging bucket and DNS owner.
- Exact app and artifact hostnames plus cookie-domain policy.
- Upload/verification/cleanup permissions and how the operator supplies credentials.
- Supported browser/resource matrix and acceptable publication/retention windows.
- Expected traffic, requests, storage, transfer and logging/retention inputs for a
  cost review. This proposal makes no price estimate or purchase commitment.
- Explicit approval to provision/configure staging and to run the hosted matrix.

Until those inputs are accepted, qualification item P2 remains **awaiting review**.
No hosted resources, DNS, credentials, distribution settings or separate app have
been accessed or modified. Shop adoption stays held for #257; the timer is off.
