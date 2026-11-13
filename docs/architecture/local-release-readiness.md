# Local release readiness

The breaking framework changes require a new major release. `3.0.0-rc.1` remains a
proposal, not a selected version or publication authorization. Existing package versions
must not be republished with different contents.

PR #378 (`adca50c36a93ea9d20cd79049f7d1ac7581cb261`) was closed without merging.
Its proposed prerelease channel and immutable publication-recovery workflow are not
present in this integration. The current release policy accepts stable versions and
the existing workflow publishes through the stable path. Do not use that workflow to
publish this proposed release candidate. Port/review the required channel isolation
and unknown-registry-state rejection, or establish another explicitly reviewed release
procedure, before selecting a candidate version.

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
No tag, registry pointer, GitHub release, image or external application is changed by
this local readiness work.
