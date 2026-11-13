# Stable release operator procedure

The release version is shared by all five package manifests. The maintainer owns
merge, tag creation and publication. Local validation does not authorize hosted
provisioning or deployment.

## Release

1. Review the source, migration notes and acceptance results. Bump all five
   packages together through the repository version tool and regenerate the
   lockfile. Run readiness with authoritative npm lookup before selecting a new
   version; never overwrite an existing version or move an existing release tag.
2. Merge the reviewed change into `main`. Tag the intended main commit with `v`
   followed by its package version. A separate main-CI result is not a release
   prerequisite: the release workflow runs its own mandatory quality gate.
3. Push the tag, or dispatch `Release` with both its workflow ref and `tag` input
   set to that tag. The workflow checks version matching, installs the pinned
   toolchain, runs the full release quality gate, builds the packages and
   dry-runs workspace publication. A failed check stops publication.
4. Before publishing anything, the publisher reads metadata for all five existing
   npm packages. It skips versions confirmed present and publishes missing
   versions with `npm publish --workspace <name> --access public --tag latest
   --provenance`. Network errors, HTTP errors (including 404 for an existing
   package) and malformed metadata stop the run before the first upload.
5. A successful npm command means the upload was accepted. npm may still be
   processing it; registry metadata and installation can lag by several minutes.
   The publisher does not fail or upload again merely because the new version is
   not immediately visible. Once all commands succeed, the GitHub Release and
   container jobs run independently. Their success is reported separately.
6. Confirm all five versions and `latest` pointers become visible on npm, then
   check provenance, GitHub release, image tags and SBOM. Dry-run checks cannot
   establish trusted-publisher authorization, live provenance issuance or registry
   processing completion. Investigate a version that stays unavailable; do not
   replace it with different bytes at the same version.

## Retry and partial publication

Allow npm processing to settle and inspect package versions before retrying a
failed or interrupted run, especially if npm acknowledged an upload. Retry the
failed job or dispatch the same tag and workflow ref:

```sh
# Replace this with the original failed run's immutable tag.
RELEASE_TAG=vMAJOR.MINOR.PATCH
gh workflow run release.yml --ref "$RELEASE_TAG" -f tag="$RELEASE_TAG"
```

The same source is rebuilt, confirmed existing versions are skipped, and missing
versions are published. Registry lookup errors never count as version absence.
This restores workspace publication: retries do not restore saved tarballs or
compare existing versions against archive hashes. If source changes are required,
use a new reviewed version and tag. Do not unpublish or move a tag to force a retry.

The workflow source must match the checked-out tag for OIDC provenance. Normal
quality gates still apply to retries. A container failure can occur after npm
publication; retry its failed job separately after checking the published state.

## Earlier release attempts

Older immutable tags retain their original workflows, including any removed CI
prerequisite or archive-recovery input. They do not acquire fixes from `main`.
The v3.0.0 archive parser and v3.0.2 archive-path failures happened before npm
publication. The v3.0.3 run `43506462289` successfully published
`@getstrata/core@3.0.3`, then failed because its immediate metadata check ran before
npm processing completed. The other four packages were not published by that run.
Version 3.0.4 restores workspace publication and removes that immediate check.
Preserve the old tags and the already published core version.

The stable workflow uses npm and container `latest`. Prerelease channels require
separate isolation and validation; do not send an RC tag to this workflow.
