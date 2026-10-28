# M1 C1: bounded failed-startup cleanup

Status: implemented in the provisional M1 startup path, with source, real PostgreSQL and packed-entrypoint acceptance. This does not approve merging, release, deployment or production adoption.

Review baseline: PR #377, `f5da44063c8937ff2ced8156b91273f72df9d614`. The human selected bounded asynchronous cleanup rather than a watchdog-only policy on 2026-10-26.

## 1. Evidence and decision

The reconstructed C1 probe holds a real provider drain after a route factory throws. With `SHUTDOWN_TIMEOUT_MS=40`, startup remains pending at about 162 ms and provider close has not run. Releasing the drain preserves the original error, closes once and permits a clean retry.

This establishes the absence of a failed-startup cleanup deadline on this path. It does not establish that the documented ordinary shutdown timeout already covers it, or that a finite observation proves an infinite wait.

The implementation bounds waiting for cleanup of a returned, candidate-owned context. Expiry reports pending cleanup, not cancellation, completion, successful startup, or permission to retry. The original probe only configured ordinary `SHUTDOWN_TIMEOUT_MS`; observing pending startup at 166 ms does not test the new 30-second default. Set `startupCleanupTimeoutMs` explicitly to probe that budget.

## 2. Implemented provisional configuration and scope

The provisional M1 options include `startupCleanupTimeoutMs?: number`. The default is 30,000 ms, a policy choice rather than an experimentally established performance value. A supplied value must be a safe integer in 1..2,147,483,647; invalid values reject before claiming a startup reservation or acquiring providers.

Keep this budget distinct from `SHUTDOWN_TIMEOUT_MS`. The latter retains its existing normal lifecycle meaning. Do not introduce a new environment variable or shorten production drain/queue leases. Tests can supply a short explicit budget to their own fixtures.

The deadline begins when failed-startup cleanup is entered, after preserving and annotating the primary error. It covers the owned asynchronous stop/drain/flush/close sequence and confirmation of metadata restoration.

Scope is the context already returned by `createAppContext`. Provider acquisition or cleanup hidden inside an unresolved `createAppContext` promise has no returned ownership/disposition handle today. The implementation does not bound that path. Covering it requires a separate narrow provider-acquisition/disposition contract; the existing conservative reservation rule remains.

This is not a total startup timeout. A supervisor still needs a total startup/process watchdog for acquisition hangs, event-loop blocking, native stalls and genuinely unresolved cleanup. That limitation supplements the bounded policy; it does not replace it with the watchdog-only option.

## 3. Ownership and completion protocol

1. Start one owned cleanup sequence, once. Preserve the original error object and the context, listener, publication and reservation identities.
2. Observe its completion and a timer. The timer bounds the caller's wait; it does not abort SQL, cancel promises, stop provider work or run force-close callbacks.
3. Before expiry, successful cleanup restores metadata only through the existing ownership-checked restoration handle, then releases only this attempt's reservation and rejects with the original startup error.
4. A cleanup rejection before expiry produces the existing aggregate-error shape with the original error as `cause`, and retains the reservation.
5. At expiry, reject startup with an aggregate containing the primary error and a deadline error. Use the safe diagnostic `{ stage: 'cleanup', code: 'startup-cleanup-timed-out', field: 'application', owner: 'application' }`.
6. Keep observing the same cleanup promise after expiry. Consume both fulfillment and rejection; never launch disposal again or permit a late successful startup.
7. On late fulfillment, conditionally restore metadata and release the owned reservation only if cleanup and restoration are both confirmed. A foreign context must remain untouched; its presence can still prevent another startup even after the reservation is released.
8. On late rejection, stop at the existing safe phase boundary, retain the reservation and resolve a failed disposition. On metadata conflict, preserve foreign rows and retain the reservation.

A drain rejection or pending drain never permits flush/close. A flush/close rejection remains a failure even if one socket was released or one connection was closed. If listener admission cannot be confirmed stopped, do not proceed to close infrastructure underneath potentially admitted work; report a blocked disposition instead.

Do not change the existing coordinator's force policy or retry the context's memoized disposal. The observer is a small private M1 operation around the existing cleanup owners, not a second container or replacement lifecycle subsystem.

## 4. Public M1 completion observation

The deliberate M1-only accessor is exported from `@getstrata/bootstrap/m1` and backed by a private WeakMap of framework-created failures:

```ts
type M1StartupCleanupOutcome = Readonly<{
  state: 'cleaned' | 'cleanup-failed' | 'metadata-conflict';
  startupReservationReleased: boolean;
  errors: readonly unknown[];
}>;

getM1StartupCleanupCompletion(
  failure: unknown,
): Promise<M1StartupCleanupOutcome> | undefined;
```

The completion promise resolves once and never rejects, including late failures. Observing or ignoring it cannot create an unhandled rejection. The framework does not mutate the delivered startup rejection, its primary cause or its diagnostic when late cleanup settles. Record completion handles for both deadline and cleanup-failure aggregates; timely successful cleanup still rethrows the original startup error without wrapping it.

`startupReservationReleased` certifies only this reservation's disposition. It is not a universal retry certificate: a foreign context, another owner's metadata or other current validation can still block startup.

`errors` follows the internal-error convention of `ShutdownResult.errors`; it is not a sanitized transport record. A false metadata-restoration result creates a known ownership error rather than dropping that failure. Use `describeM1Failure` for bounded public diagnostics. Do not read arbitrary error messages/getters to identify ownership, parse secrets from them, or JSON-serialize internal causes.

The accessor reads its private WeakMap only. An unknown failure returns `undefined`; that is not evidence that cleanup was safe or that no resources were acquired. Keep the new accessor/type an explicit provisional M1 export, not a shared 2.x export or broad new subpath.

## 5. Terminal outcomes

- Timely success: original startup error, cleanup complete, owned metadata restored, reservation released once.
- Timely cleanup failure: aggregate with original cause, failed disposition, reservation retained.
- Deadline followed by success: caller receives timeout; close waits for drain; completion later reports cleaned and conditional restoration/release exactly once.
- Deadline followed by drain rejection: original startup cause remains; flush/close do not run; reservation remains held.
- Deadline followed by close rejection: already closed resources do not turn the outcome into success; retain the reservation and actual cleanup error.
- Deadline followed by metadata conflict: never overwrite foreign rows; report conflict and retain the reservation.
- Never-settling cleanup: caller receives timeout, completion remains pending, ownership remains held, and process recovery is required.

## 6. Timing and cancellation limits

A JavaScript timer is an asynchronous notification, not a hard real-time limit. Synchronous callback loops and a blocked event loop cannot be preempted by this mechanism. Do not describe timeout as cancellation or claim process termination occurred.

Define the deadline race by the first terminal observer callback processed. Clear the timer on ordinary completion and keep all late handlers installed until cleanup settles. Do not mutate a delivered error/result with later failures.

Keep a single reservation and one cleanup task alive. Do not permit an accumulating sequence of new attempts while an earlier task can still act on shared resources. Release closures/records naturally after settlement and loss of caller references; do not add a global completed-attempt history.

## 7. Historical design-only feasibility evidence

The opt-in [`scripts/fixtures/m1-startup-cleanup-design.ts`](../scripts/fixtures/m1-startup-cleanup-design.ts) is a design experiment, not imported by framework source or a replacement for M1 regression acceptance. It uses actual provider `drain`/`flush`/`dispose`, the existing reservation and registry handles, and an owned native Bun listener. Each case runs in a separate process.

Run from the framework root with Bun 1.4.4 or a qualified later 1.4.x. The example uses only disposable local fixture settings and disables automatic environment-file loading:

```sh
for mode in timely late-success late-drain-rejection late-metadata-conflict late-close-rejection; do
  env SKIP_FIXTURE_TEST_BOOTSTRAP=1 APP_ENV=test \
    DATABASE_URL=sqlite://:memory: TENANCY_DRIVER=none \
    CACHE_DRIVER=array QUEUE_DRIVER=sync STORAGE_DRIVER=local \
    SESSION_SECRET=review-owned-long-session-secret-for-local-tests \
    bun --no-env-file run scripts/fixtures/m1-startup-cleanup-design.ts "$mode"
done
```

Each process asserts its outcome and prints `designOnly: true`. Failed ownership reservations intentionally survive until that process exits. This command does not install a framework deadline, run SQL migrations or access a deployment provider.

All five design experiments passed:

- timely cleanup preserved exact primary error identity, restored metadata and released once;
- timed-out wait followed by late success kept the resource live while draining, then closed once and allowed a clean retry;
- late drain rejection left flush/close uncalled and retry blocked;
- late metadata conflict retained foreign rows and blocked retry;
- late close rejection remained failed and blocked retry even after the test socket closed.

Each late case preserved the primary cause and observed no unhandled rejection. The 20 ms delay belongs only to these disposable experiments. No framework timeout, production lease, external database, Redis or deployment was changed.

This evidence demonstrates an ownership-preserving observer is feasible. It does not qualify a C1 framework implementation, SQL cancellation, providers that never return context, an installed package or hosted recovery.

## 8. Actual framework implementation and acceptance

`src/bootstrap/m1/startupCleanup.ts` observes one cleanup sequence. Both timeout and timely cleanup-failure aggregates receive the completion handle. The same sequence continues after expiry; its terminal handlers consume late outcomes and never reject the completion promise. Safe diagnostics and delivered errors are not rewritten by late settlement.

Desired-behavior tests failed on unchanged `613d817`, then passed with the runtime implementation:

- `m1StartupCleanup.test.ts`: 21 process-isolated actual-startup cases covering validation, timely outcomes, default/separate budgets, pending stop/drain/flush/close, never-settling cleanup, late failures, foreign context/metadata, ignored notifications and unknown acquisition.
- `m1StartupCleanupLocal.test.ts`: in-process public-contract and expiry assertions, including getter safety, stable frozen outcomes, ownership retention and corrected retry.
- `m1StartupCleanupSql.integration.test.ts`: two real restricted-PostgreSQL cases. Held ORM work survives expiry, preserves RLS and savepoint rollback, commits, runs its deferred observer, then drains/flushes/closes. A native invalid-close-timeout rejection retains committed data and blocks retry. This is deterministic fault injection, not a spontaneous network-failure claim. Every UUID-owned table is dropped and checked absent.
- `m1PackedContext.test.ts`: all original installed-context assertions plus five actual public-entrypoint cases: timely failure, late success, ignored late failure, metadata conflict and never-settling cleanup.
- `m1StartupCleanup.contract.ts`: option and readonly-outcome typing, also included in the existing ten-profile/three-compiler generated-app gate outside repository source aliases. No extra Cartesian starter profiles were added.

The focused M1/shared/database inventory passed 211 cases, zero failures, 718 assertions across 35 files, with all nine M1 source modules at 100% function/line coverage. All five packed cases passed. Normal full gates and new exact-head CI remain required for the PR update; their actual results are recorded separately.

An initial focused run omitted initialization of the fresh framework fixture database and returned HTTP 500 errors. Unchanged `613d817` reproduced those failures. Initializing only that owned fixture through the real CLI restored the unchanged inventory; failed logs remain retained.

### Additional confirmed stop-ordering correction

The requested post-bind characterization reproduced a separate unsafe ordering: an injected listener-stop rejection left a real admitted HTTP request pending, but the old cleanup path still closed provider resources. The regression failed with close count one. Cleanup now stops at that failure, leaves providers live, exposes a failed completion handle and blocks retry. This does not claim rollback of arbitrary extension effects or support for mixed application owners.

F1/F2 remain separately verified. C1 is now implemented for the returned-context scope through the actual startup path; the historical model and green CI on the old head are not substituted for the new acceptance.

## 9. Release and adoption

The existing 2.x entrypoints, application, shop and package versions remain unchanged. The PR remains a draft; this design gives no merge, release, deployment or application-adoption approval.

Shop adoption remains held for #257 and the timer remains off. The separate app is not involved. Hosted artifact qualification and the other previously disclosed M1 acceptance gaps remain separate.
