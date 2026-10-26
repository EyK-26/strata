# M1 C1: bounded failed-startup cleanup

Status: design proposal and isolated feasibility evidence only. No C1 deadline is integrated into `startGuardedApplication`, released or deployed.

Review baseline: PR #377, `f5da44063c8937ff2ced8156b91273f72df9d614`. The human selected bounded asynchronous cleanup rather than a watchdog-only policy on 2026-10-26.

## 1. Evidence and decision

The reconstructed C1 probe holds a real provider drain after a route factory throws. With `SHUTDOWN_TIMEOUT_MS=40`, startup remains pending at about 162 ms and provider close has not run. Releasing the drain preserves the original error, closes once and permits a clean retry.

This establishes the absence of a failed-startup cleanup deadline on this path. It does not establish that the documented ordinary shutdown timeout already covers it, or that a finite observation proves an infinite wait.

Introduce a bounded wait for cleanup of a returned, candidate-owned context. Expiry reports pending cleanup, not cancellation, completion, successful startup, or permission to retry.

## 2. Proposed configuration and scope

Add `startupCleanupTimeoutMs?: number` to the provisional M1 options. Proposed default: 30,000 ms. Validate a safe integer in 1..2,147,483,647 before claiming a startup reservation or acquiring providers. Reject invalid values rather than clamping them.

Keep this budget distinct from `SHUTDOWN_TIMEOUT_MS`. The latter retains its existing normal lifecycle meaning. Do not introduce a new environment variable or shorten production drain/queue leases. Tests can supply a short explicit budget to their own fixtures.

The deadline begins when failed-startup cleanup is entered, after preserving and annotating the primary error. It covers the owned asynchronous stop/drain/flush/close sequence and confirmation of metadata restoration.

Initial scope is the context already returned by `createAppContext`. Provider acquisition or cleanup hidden inside an unresolved `createAppContext` promise has no returned ownership/disposition handle today. This proposal does not silently claim to bound that path. Covering it requires a separate narrow provider-acquisition/disposition contract; the existing conservative reservation rule remains.

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

## 4. Proposed consumer observation

Expose one deliberate M1-only accessor, backed by a private WeakMap of framework-created failures:

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

## 7. Feasibility evidence

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

## 8. Implementation and acceptance work still required

1. Review the proposed option/default, explicit completion accessor and known-context scope.
2. Add desired-behavior regressions to the real M1 startup path before wiring the observer. Cover timely success/failure, expiry, never-settling drain, late success/rejection, close failure and foreign context/metadata replacement.
3. Verify invalid budgets reject before reservation/provider acquisition; preserve primary error identity, safe diagnostics, exactly-once disposal and stable delivered rejection/completion objects.
4. Verify a timed-out startup never binds later, never resolves an app, never force-closes an undrained resource and never enables premature retry. Characterize post-bind stop failure before changing that cleanup branch.
5. Assert late failures are handled even when callers ignore the completion accessor. Test retention and recovery in isolated processes rather than resetting ownership globals.
6. Add a real restricted-PostgreSQL lifecycle case for pending transactional work before declaring SQL/resource ordering qualified. Retain RLS, deferred observer, savepoint and drain-before-close assertions.
7. Verify source and packed consumer ownership/diagnostics through the intended public M1 entrypoint, then run normal required gates and exact-head CI when applying the changes to the PR.

F1/F2 have separate minimal runtime fixes and regression tests in this PR. Do not label C1 implemented or resolved by those fixes, this design experiment, or green CI on the old head.

## 9. Release and adoption

The existing 2.x entrypoints, application, shop and package versions remain unchanged. The PR remains a draft; this design gives no merge, release, deployment or application-adoption approval.

Shop adoption remains held for #257 and the timer remains off. The separate app is not involved. Hosted artifact qualification and the other previously disclosed M1 acceptance gaps remain separate.
