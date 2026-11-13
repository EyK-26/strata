# Local release readiness

The breaking framework changes require a new major release. The release proposal is
stable `3.0.0`, subject to complete acceptance and the publisher's version selection.
This matches the repository's existing stable-only version validation, npm `latest`
channel and container `latest` policy. `3.0.0-rc.1` would require separately reviewed
prerelease isolation for npm, GitHub and container channels; do not pass it to the
stable workflow. Existing package versions must not be republished with different
contents. The completion-sprint user authorization permits merge and publication
only after all acceptance gates; the root operator owns those actions.

PR #378 (`adca50c36a93ea9d20cd79049f7d1ac7581cb261`) was closed without merging.
The reconciled release workflow now builds an immutable archive set before any npm
mutation, retains it as an Actions artifact, and publishes those archive bytes with
OIDC provenance. A registry version is reusable only when its `dist.integrity`
exactly matches the archived SHA-512. Registry errors or malformed metadata abort
before publication; they never establish that a version is unused. The workflow
requires successful main-push CI for the exact release commit before running its
own release quality gate. See [release operator procedure](release-operator.md).

Local acceptance must identify the source commit, package manifests, archive hashes,
commands and fixture cleanup. Build fresh core/bootstrap/starter packages, verify public
exports and types, run the required unit/integration coverage, E2E and smoke gates, and
qualify generated consumers from those archives. Check required CI once the integrated
head is ready; an earlier green run does not qualify changed code. Record limitations
and failures rather than treating a successful health boot as complete app acceptance.

The release must also complete the remaining ownership work listed in
[target API migration](target-api-migration.md), including view configuration and queue
actor/tenant delivery. The bounded profile inventory and capability map are described
in [starter qualification](../STARTER-QUALIFICATION.md).

Publication, hosted qualification and deployment remain separate decisions. Before a
hosted run, specify provider/account, resource names, domains and cookie isolation,
permissions, spending limits, retention and cleanup ownership. Local loopback SMTP,
S3-compatible HTTP, IdP and database fixtures do not establish live provider behavior.
This document records readiness and procedure; it does not establish that a tag,
registry pointer, GitHub release, image or external application has changed.
