# Stable release operator procedure

The release version is the shared version in the five package manifests. The
publisher selects it only after the required acceptance inventory passes. A failed
or incomplete gate blocks merge/publication. Local fixtures do not qualify hosted
providers or authorize provisioning/deployment. The release maintainer monitors
CI, creates the tag and initiates publication.

## Admission and publication

1. Reconcile the final capability inventory, migration instructions and local
   acceptance receipt. Record exact source SHA, commands/results, fresh packed
   consumer tests, fixture cleanup and remaining limits. Prepare release notes
   describing breaking application composition, runtime ownership, capability and
   request-context changes, and the supported starter profiles. Link migration and
   starter qualification documents from those notes.
2. Bump all five packages together through the repository version tool. Regenerate
   required manifests/export metadata and lockfile through their owning tooling.
   Run readiness with the selected tag and authoritative npm lookup; an existing
   version requires a new version, never changed contents at the same version.
3. Complete the full required local gate, independent review and exact-head PR CI.
   Merge the reviewed result into actual `main`. Wait for successful `CI` from the
   `push` event at the exact merged SHA. A prior PR green run or earlier main SHA
   does not qualify. The release workflow checks this API evidence itself once;
   it fails immediately if no successful run exists and does not wait for CI.
4. The maintainer tags that exact SHA with `v` followed by the package version and
   pushes the tag, or dispatches `Release`
   with an already verified existing tag and the workflow ref set to that tag.
   Tag pushes trigger publication. The
   workflow repeats the release quality gate, packs each package once, records the
   source commit/tag/archive identity in `manifest.json`, then uploads the entire
   archive set before its first registry mutation. The pinned npm CLI dry-runs
   publication of every archive before live publication; CI exercises the same
   pack and dry-run commands. A dry-run validates local archive handling, not
   trusted-publisher permissions or live provenance issuance.
5. All registry metadata and archive hashes are validated before the first npm
   publish. Missing HTTP responses, 404, 429, server failures and malformed package
   records abort. Existing matching versions are verified, not republished. New
   archives publish publicly to npm `latest` with trusted-publishing provenance.
6. After all five archive integrities are confirmed on npm, GitHub Release and
   container jobs run independently. GitHub Release retains the archives and
   manifest as assets. Confirm all package versions, npm `latest` pointers,
   provenance, GitHub assets, image version/latest pointers and SBOM. Record their
   URLs and publication run ID. A container failure can coexist with successful
   npm and GitHub publication; report each outcome independently.

## Tag created before main CI passed

`No successful main CI run for <commit>` means release admission failed before
dependency installation, package packing or npm publication. Wait for successful
main-push CI at that exact commit, then rerun the failed release job or dispatch
`Release` with both its workflow ref and `tag` input set to the existing tag. Do
not supply `recovery_run_id`: this early failure did not upload release archives.
The same tag can be retried once its commit qualifies; moving the tag is unnecessary.
If additional source changes are needed, merge them with a new package version and
wait for that commit's main CI before creating a new tag.

## Partial publication and recovery

The `v3.0.0` attempt passed its quality gate and builds, then failed before archive
upload or npm publication: npm 12 changed `npm pack --json` from an array to a
package-keyed object. Preserve that tag. The `3.0.1` patch accepts both formats and
checks the reported identity and integrity against each archive. `.npm-version`
pins the CLI used by publication and CI's real packing/publication dry-run checks.
Upgrade that pin through a reviewed change with both checks passing.

The `v3.0.2` attempt passed exact-commit CI admission and the quality gate, and
retained all archives in Release run `43495727684`. The first npm publish failed
with `EALLOWGIT`: npm interpreted the bare relative tarball path as GitHub
repository shorthand. No package was published by that attempt. Version `3.0.3`
resolves archive paths absolutely and adds publication dry-runs. Preserve the
`v3.0.2` tag; retrying it or restoring its archives still executes the old code
and cannot apply this source fix. Merge the fix, wait for successful main CI,
then tag the new commit `v3.0.3`. Do not pass the v3.0.2 run as a recovery source
for v3.0.3: recovery requires the same source commit and archive identities.

Publication is not atomic across registries or packages. If any step fails, first
record which effects occurred. Do not move a tag, unpublish packages, overwrite a
version, or create new archive bytes to force progress.

For a transient npm failure after archive upload with an otherwise valid publisher,
the maintainer dispatches the same `Release` workflow
with the same tag, workflow ref set to that tag, and `recovery_run_id` set to the original Release run ID:

```sh
# Set this to the original failed run's tag, not a newer local package version.
RELEASE_TAG=vMAJOR.MINOR.PATCH
gh workflow run release.yml --ref "$RELEASE_TAG" -f tag="$RELEASE_TAG" -f recovery_run_id=ORIGINAL_RUN_ID
```

The workflow rejects `GITHUB_SHA` differing from the checked-out release commit,
so npm provenance cannot identify a newer default-branch commit as its source. It
requires the source run to be this workflow at the exact tagged SHA, downloads its
immutable `release-archives` artifact, and verifies its manifest and every archive
hash. Already published package versions must have matching registry integrity;
only missing versions publish. The quality and exact-head CI gates still apply.
If the registry is temporarily unavailable, retry recovery after it is healthy.
A registry archive mismatch requires investigation and a new reviewed version;
it cannot be bypassed through recovery.

Use a new workflow dispatch for recovery, rather than re-running the original pack
job. Actions artifacts are immutable and retained for 90 days; a rerun cannot
replace an artifact with the same name. Once a GitHub Release exists, its attached
archives provide durable evidence. If the original artifact expired before full
publication, this automated recovery path is unavailable: establish a separately
reviewed exact-byte recovery procedure before further publication. Never silently
rebuild archives as a replacement for missing publication evidence.

The stable workflow updates npm and container `latest`. It deliberately rejects
prerelease package versions. An RC proposal requires channel isolation and new
acceptance evidence before any RC tag is pushed.
