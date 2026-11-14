# Retrospective correctness audit

Baseline: `f5375a475b906b07c60789bf7e08ef08ac1377c4` through merged PR #409
(`baf2137`). Date: 2026-11-14.

This is a targeted correctness audit of the refactor and the older code it uses.
The historical diff spans 1,058 files; this report does not claim every line was
independently reviewed or that passing tests establishes the absence of defects.
No additional architectural redesign, version bump or release is included.

## Method

- Inspect installed package boundaries, database and queue ownership, authentication
  proofs, configuration capture, and generated authentication workflows.
- Reproduce suspected defects before changing implementation. Preserve the
  regressions as behavioral tests, including rejected and successful paths.
- Challenge changes through an independent review and a second relevant check.
  Use packed packages or real services where source-only tests miss the boundary.
- Keep existing validation requirements; do not relax assertions or coverage gates.

## Confirmed additional findings

| Finding | Before | Correction and regression evidence |
| --- | --- | --- |
| Raw PostgreSQL pool shutdown | New SQL and checkout could enter while native close was pending; concurrent close repeated native cleanup. | Seal admission synchronously and share the cleanup promise, including opaque failures. Gated native-adapter tests cover pending, successful and failed cleanup. |
| Raw MySQL pool shutdown | The same admission/disposal race existed during `pool.end()`. | Apply the same ownership rule; tests prove rejected checkout/SQL never enter the driver and disposal happens once. |
| Synchronous production queue shutdown | `ResilientQueue` tracked asynchronous jobs but could close before synchronous dispatch finished. A job could also initiate close before its own work was registered. | Track both dispatch modes, register before executing the runner, and retain dispatch error propagation. Test successful/failed jobs, child jobs and reentrant shutdown initiation. |
| Password-confirmation proof confusion | A supported legacy session cookie could be copied to the confirmation cookie when both shared the default secret, passing confirmation without re-entering the password. | Include the confirmation purpose in the HMAC input. Middleware regression rejects substituted sessions, accepts genuine proofs, and rejects reverse substitution. |
| Generated GitHub login CSRF | A valid signed state created in one browser was accepted in another browser; the callback ignored browser association. | Issue a short-lived HttpOnly state cookie, match it before exchanging the authorization code, and clear it on callback outcomes. Generated-route tests exercise missing/different cookies and successful/provider-failed callbacks. |
| Generated SAML login CSRF | Signed RelayState and assertion replay protection did not associate a fresh assertion with the initiating browser. | Use a dedicated browser-state cookie and reject missing/mismatched state before consuming the assertion. Keep signature, audience, recipient, destination and SQL replay validation. |

The raw adapters were introduced after the baseline in `f8def92`. The queue drain
implementation (`2e0e27a`), legacy confirmation format and signature-only OAuth state
already existed before the baseline. These findings therefore include both issues
in the refactor and inherited defects; commit labels alone do not identify them.

## Consumer effects

- Existing password-confirmation cookies must be renewed once after upgrading.
  Ordinary login sessions are unchanged. Accepting the old confirmation signatures
  would preserve the substitution defect.
- Custom GitHub/OAuth consumers of `verifyOAuthState` must issue the corresponding
  browser cookie. Signature-only verification remains an explicitly separate helper;
  it does not by itself provide login-CSRF protection. OIDC retains PKCE-cookie binding.
- SAML browser login requires HTTPS: its dedicated short-lived cookie uses
  `SameSite=None; Secure` so the IdP can return it on a cross-site POST. The cookie
  is separate from GitHub's `SameSite=Lax` state and the normal application session.
- Existing generated applications need the generated route changes as well as the
  core-package upgrade. Publishing a generator does not rewrite existing apps.

## Other examined boundaries

An isolated installed-package scan checked 439 service-token export references
across core/bootstrap entrypoints without another identity mismatch. The listener
identity defect already fixed in PR #409 retains its installed-runtime regression.
Database review also examined SQLite admission, retained transaction handles and
read-only observation disposal. No further confirmed defect was identified there.
Review of permissive legacy numeric cookie parsing did not establish an identity
or lifetime forgery, because the signature is recomputed over the parsed values;
no speculative parser change was made.

## Final validation

- Full unit/integration run: **4,072 passed, 2 existing MySQL/RLS cases skipped,
  zero failed**, across 487 files. Coverage gate passed: 221 enforced files and
  the unchanged 258-file exemption baseline.
- Typecheck, lint, module/application boundaries and core/bootstrap/starter builds passed.
- Published export declarations (236 entries), shared identity shims (33) and
  optional dependency checks passed.
- Packed SQLite SAML acceptance passed with independently signed assertions,
  missing/different-browser state rejection, SQL replay protection, sessions,
  account creation, MFA and feature gates. GitHub/OIDC/Stripe HTTP smoke passed.
- Focused regression runs preceded the final suite. Independent review of queue
  draining found the reentrant admission gap, which received its own regression.
  Reviewed snapshot changes are limited to the changed auth modules and README output.

These checks use local fixtures, not live GitHub/enterprise IdP accounts. The SAML
HTTP fixture explicitly carries the cookie on loopback; it is a protocol test, not
a claim of browser-enforced HTTPS or cookie-policy coverage.
