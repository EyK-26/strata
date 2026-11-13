# Local release readiness

The breaking framework changes target the stable 3.x release line. The current
release version comes from the five lockstep package manifests. This matches the
repository's stable-only version validation, npm `latest` channel and container
`latest` policy. A prerelease would require separately reviewed
prerelease isolation for npm, GitHub and container channels; do not pass it to the
stable workflow. Existing package versions must not be republished with different
contents. The release maintainer checks the required acceptance results and owns
tag creation and publication.

PR #378 (`adca50c36a93ea9d20cd79049f7d1ac7581cb261`) was closed without merging.
The reconciled release workflow now builds an immutable archive set before any npm
mutation, retains it as an Actions artifact, and publishes those archive bytes with
OIDC provenance. A registry version is reusable only when its `dist.integrity`
exactly matches the archived SHA-512. Registry errors or malformed metadata abort
before publication; they never establish that a version is unused. The workflow
runs its own mandatory release quality gate before publication; it does not query
or wait for a separate main-branch CI run. See [release operator procedure](release-operator.md).

Local acceptance must identify the source commit, package manifests, archive hashes,
commands and fixture cleanup. Build fresh core/bootstrap/starter packages, verify public
exports and types, run the required unit/integration coverage, E2E and smoke gates, and
qualify generated consumers from those archives. Check required CI once the integrated
head is ready; an earlier green run does not qualify changed code. Record limitations
and failures rather than treating a successful health boot as complete app acceptance.

The runtime/API refactor and code retirement are complete, including owned view
configuration and authenticated queue actor/tenant delivery. The
[target API migration](target-api-migration.md) describes the resulting contracts;
the [completion ledger](refactor-completion-ledger.md) maps their acceptance tests.
The bounded profile inventory and capability map are described in
[starter qualification](../STARTER-QUALIFICATION.md). Each release still requires
acceptance for its own source commit.

Tag the reviewed main commit with the matching package version. The release's
own quality gate must pass before publication, even when a separate CI run is
pending or failed. See the [release operator procedure](release-operator.md).

Publication, hosted qualification and deployment remain separate decisions. Before a
hosted run, specify provider/account, resource names, domains and cookie isolation,
permissions, spending limits, retention and cleanup ownership. Local loopback SMTP,
S3-compatible HTTP, IdP and database fixtures do not establish live provider behavior.
This document records readiness and procedure; it does not establish that a tag,
registry pointer, GitHub release, image or external application has changed.
