interface PackageVersion {
  name: string;
  version: string;
}

interface ReleaseReadiness {
  version: string | null;
  errors: string[];
}

const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

function parseReleaseTag(tag: string): string | null {
  return tag.trim().match(RELEASE_TAG_PATTERN)?.[1] ?? null;
}

function resolveLockstepVersion(packages: readonly PackageVersion[]): ReleaseReadiness {
  if (packages.length === 0) {
    return { version: null, errors: ["No packages were checked."] };
  }

  const missing = packages.filter((entry) => !entry.version.trim());
  if (missing.length > 0) {
    return {
      version: null,
      errors: [`Missing version for ${missing.map((entry) => entry.name).join(", ")}.`],
    };
  }

  const byVersion = new Map<string, string[]>();
  for (const entry of packages) {
    byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry.name]);
  }

  if (byVersion.size > 1) {
    const detail = [...byVersion.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([version, names]) => `  ${version}: ${names.sort().join(", ")}`)
      .join("\n");

    return {
      version: null,
      errors: [`Package versions are not in lockstep:\n${detail}`],
    };
  }

  return { version: packages[0]?.version ?? null, errors: [] };
}

function checkReleaseReadiness(input: {
  packages: readonly PackageVersion[];
  tag?: string;
  publishedVersions?: readonly string[];
}): ReleaseReadiness {
  const lockstep = resolveLockstepVersion(input.packages);
  const errors = [...lockstep.errors];
  const version = lockstep.version;

  if (input.tag !== undefined) {
    const tagged = parseReleaseTag(input.tag);

    if (tagged === null) {
      errors.push(`Tag "${input.tag}" is not a release tag of the form v1.2.3.`);
    } else if (version !== null && tagged !== version) {
      errors.push(
        `Tag ${input.tag} does not match the package version ${version}. ` +
          `Bump every package to ${tagged}, or tag this commit v${version}.`,
      );
    }
  }

  if (version !== null && input.publishedVersions?.includes(version)) {
    errors.push(
      `Version ${version} is already published. Bump every package before tagging again.`,
    );
  }

  return { version, errors };
}

function checkReleaseTarget(input: {
  ref: string;
  refResolved: boolean;
  refVersion: string | null;
  workingTreeVersion: string | null;
  headOnRef: boolean;
}): string[] {
  const errors: string[] = [];

  if (!input.refResolved) {
    errors.push(
      `Could not read package versions from ${input.ref}. Run \`git fetch origin main\` first.`,
    );
    return errors;
  }

  if (input.refVersion === null) {
    errors.push(`Package versions on ${input.ref} are not in lockstep.`);
    return errors;
  }

  if (input.workingTreeVersion !== null && input.refVersion !== input.workingTreeVersion) {
    errors.push(
      `${input.ref} is at ${input.refVersion} but this working tree is at ${input.workingTreeVersion}. ` +
        `Tagging ${input.ref} would publish ${input.refVersion}. Merge the bump first.`,
    );
  }

  if (!input.headOnRef) {
    errors.push(
      `HEAD is not contained in ${input.ref}, so the code verified here is not the code that would be tagged.`,
    );
  }

  return errors;
}

export type { PackageVersion, ReleaseReadiness };
export { checkReleaseReadiness, checkReleaseTarget, parseReleaseTag, resolveLockstepVersion };
