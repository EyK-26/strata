# Stable major release operator procedure

The proposed version is `3.0.0`. The publisher selects it only after the complete
breaking-refactor acceptance inventory passes. A failed or incomplete gate blocks
merge/publication. Local fixtures do not qualify hosted providers or authorize
provisioning/deployment. The completion-sprint authorization covers merge and a new
release once accepted; root owns GitHub and registry operations.

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
   does not qualify. The release workflow checks this API evidence itself.
4. Root tags that exact SHA with `v3.0.0` and pushes the tag, or dispatches `Release`
   with an already verified existing tag. Tag pushes trigger publication. The
   workflow repeats the release quality gate, packs each package once, records the
   source commit/tag/archive identity in `manifest.json`, then uploads the entire
   archive set before its first registry mutation.
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

## Partial publication and recovery

Publication is not atomic across registries or packages. If any step fails, first
record which effects occurred. Do not move a tag, unpublish packages, overwrite a
version, or create new archive bytes to force progress.

For an npm failure after archive upload, root dispatches the same `Release` workflow
with the same tag and `recovery_run_id` set to the original Release run ID. It
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
