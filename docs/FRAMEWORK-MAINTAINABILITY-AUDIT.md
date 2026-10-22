# Compatible framework maintainability audit — 2.2.49

This closes the compatible framework work reviewed on 20–21 October 2026. The
published runtime is [2.2.49](https://github.com/EyK-26/strata/releases/tag/v2.2.49),
commit `bbd15b226e385487e3cfe0bd4938fbe603ce2593`, tree
`c096e34d0659c53086564936652a943f752809dd`. This documentation does not change a
package version, runtime contract, generated artifact, assertion or coverage rule.

## What became easier to change

- **Ownership and substitution:** [#292](https://github.com/EyK-26/strata/pull/292)
  and [#299](https://github.com/EyK-26/strata/pull/299) give Docker/Mailpit fixtures
  explicit cleanup ownership, including partial startup and anonymous volumes.
  [#293–298](https://github.com/EyK-26/strata/pull/294) separate complete-integer
  configuration validation, repository rebinding construction, neutral connection
  capabilities, DI-cycle diagnostics, membership implementation/resolution and
  module rendering/filesystem effects. A custom repository can reconstruct its
  private state through its supported rebinding hook; prototype copying is not
  claimed to reconstruct arbitrary JavaScript private fields.
- **Generation:** [#300–305](https://github.com/EyK-26/strata/pull/305),
  [#310](https://github.com/EyK-26/strata/pull/310) and
  [#322](https://github.com/EyK-26/strata/pull/322) split rendering by emitted
  artifact and responsibility, preserve generated handler request types, and share
  the app-owned plain-input password-login operation across HTTP adapters. Strict
  historical and current artifact proofs distinguish byte-preserving extractions
  from the explicitly reviewed emitted auth change. Application schema, permission
  policy, navigation and HTTP transport decisions remain customizable.
- **HTTP and lifecycle:** [#306](https://github.com/EyK-26/strata/pull/306),
  [#308–309](https://github.com/EyK-26/strata/pull/309),
  [#312](https://github.com/EyK-26/strata/pull/312),
  [#315](https://github.com/EyK-26/strata/pull/315) and
  [#321](https://github.com/EyK-26/strata/pull/321) qualify real API/web cache
  composition, close provider phase admission before callbacks, isolate route
  metadata registration, and keep winning handlers paired with their metadata.
  Protected Response/callback/method-map paths retain middleware admission.
  Preserving an opaque native route value in a builder does not prove that the
  server transports it; see the explicit native-assets limitation below.
- **ORM:** [#307](https://github.com/EyK-26/strata/pull/307) preserves protected
  serialization on dirty writes. [#311](https://github.com/EyK-26/strata/pull/311),
  [#313–318](https://github.com/EyK-26/strata/pull/318) and
  [#320](https://github.com/EyK-26/strata/pull/320) separate pure attributes,
  registration/observer state, Model query ownership and relation SQL compilation;
  preserve typed relation forwarding; and correlate eager-load kinds with relation
  types. Public facades, imports, protected extension points, driver abstractions
  and real SQL/transaction behavior remain required contracts.
- **Effects and protocols:** [#319](https://github.com/EyK-26/strata/pull/319)
  releases the audit exporter's own SQL scope before HTTP delivery while retaining
  caller-owned outer transactions and exact accepted snapshot IDs.
  [#323](https://github.com/EyK-26/strata/pull/323) gives byte-preserved Redis Lua
  protocols cohesive private owners. [#324](https://github.com/EyK-26/strata/pull/324)
  separates pure SMTP/MIME assembly from socket orchestration. No universal worker,
  second crypto implementation, client substitute or shorter production lease was
  introduced.

These are responsibility and contract improvements, not a claim that every large
file needed extraction. Conditional reviews retained the existing cohesive
context, job-runner/outbox, auth, storage and migration owners where no concrete
benefit from another abstraction was established.

## Release and published acceptance

All four exact-head PR checks (test, Docker install, parallel tests and security)
passed before the guarded merges. Actual merged-main CI/security, release readiness
against actual `origin/main`, unused package versions and the absent tag were
verified before publication. The
[trusted release workflow](https://github.com/EyK-26/strata/actions/runs/39643890286)
completed successfully. Exact versions and registry integrity values for core,
bootstrap, CLI, starter and create-strata are in the
[sanitized qualification record](qualification/starter-2.2.49-runtime.json).

The final runtime source gate passed **2,620 unit/integration tests**, with **zero
failures and the same three existing macOS platform-driver skips**; **167 E2E tests
passed with zero failures/skips**. Coverage was **151 enforced files / 272
exemptions**. Package/export/type, generated compiler/OpenAPI, integration extras
and SPA gates also passed. These are the runtime release's historical results;
the documentation PR has its own mandatory pre-push and exact-head CI checks.

After publication, **all 128 registered sequential scenarios executed and passed,
with zero failures/skips**, completed at `2026-10-21T18:03:39.487Z`. The original
113 names, command arguments and timeouts were preserved except for the source-root
and exact-version substitutions. Fifteen additional real consumer contracts cover
the affected public repository, HTTP/cache, provider, Model/relation, audit-export
and Redis boundaries. The prior
[2.2.48 inventory](qualification/starter-2.2.48-runtime.json) and earlier evidence
are retained. This is selected risk-based coverage, not a Cartesian product of
every feature, engine and deployment.

Each published case has its own exit, duration and SHA-256 log receipt in the
sanitized record. Every case spawned its real harness and exited zero without a
signal. The generator and installed dependencies used exact published 2.2.49;
there were no node_modules patches, vendoring, application mechanisms replacing
framework APIs/ORM, weakened assertions, additional skips or implicit grants.
Historical failed, interrupted and deliberately red reproductions remain evidence.

## Cleanup and evidence boundaries

The complete captured pre/post SQL and Docker metadata matched, excluding only the
capture timestamp: 8 PostgreSQL databases, 26 roles, 6 MySQL schemas, 7 accounts,
14 containers, 180 volumes and 9 networks. Comparing names/identities/ownership
metadata matters; equal counts alone would not establish restoration.

The Redis fixture proved scoped cleanup preserves an unrelated owned marker before
removing its own marker. A separate read-only audit then found the recorded owned
keys/marker absent. The exclusively created qualification scratch root was removed
after its remaining exact-version Bunx cache was inventoried. Unknown historical
resources were not pruned. Original application checkouts and the two user-owned
Bun qualification files were preserved.

The committed JSON is an immutable **21 October closeout snapshot**. Its `remaining`
fields describe that time (the audit PR and major plan had not yet been written);
they are not live task status. Raw per-case logs, runner/case inventory, original
failures, publication receipts and full resource inventories remain local. They are
not copied into Git because they contain machine paths and infrastructure metadata.
The sanitized record retains package integrity and all 128 log hashes without
credentials, signed links or host paths. Before this documentation was prepared,
all log hashes, original 113 command identities, publication/workflow identities
and recorded cleanup comparisons were independently rechecked. That recheck did
not rerun the published scenarios or relabel a partial run as acceptance.

## Explicit limits and deferred work

**Native assets remain deferred to a separately accepted major-version plan by
explicit user decision.** The same BunFile, directory/range, imported HTML/bundled
JavaScript and `false` route probes succeed under raw native SDK controls but fall
through under the guarded framework server on published 2.2.48 and the tested
candidate. Denial hooks still return 403. These failed assertions are retained in
an isolated local reproducer (`f2259d4`); they are not silently removed from an
accepted 128-case inventory or presented as passing native transport coverage.

Native route dispatch precedes fallback fetch. Passing opaque assets through
without a separately designed contract could bypass framework request admission
and lifecycle tracking. This batch adds no hidden proxy, SDK emulation, guard
bypass or new public native-assets API. Existing static serving is unchanged.

Combined tenant/ORM/deferred-callback shutdown characterization was not newly
added, and simultaneous independent application contexts are not promised.
Deployed capacity/soak, live-provider interoperability, recovery/PITR, independent
security review and the native Bun SQL timer gate remain distinct qualifications.
Passing these local profiles does not close them.

**Shop adoption remains held for
[#257](https://github.com/EyK-26/strata/issues/257).** No shop package adoption or
deployment is part of this audit. Existing apps need deliberate review/adoption of
generated-source changes; installing a package does not rewrite user customization.
The recurring implementation timer was deleted at closeout and is not restarted
by this documentation. A second-batch major-version design requires review of
migration, deprecation and rollback before any breaking implementation.
