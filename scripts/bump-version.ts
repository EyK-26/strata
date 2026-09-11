const SEMVER_CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

const STRATA_CARET_PIN_PATTERN =
  /("(?:@getstrata\/[a-z-]+|create-strata)"[^\n]{0,40}?")\^\d+\.\d+\.\d+(")/g;

const EXPECTED_ENTRY_PATTERN = /("(?:@getstrata\/[a-z-]+|create-strata)"\s*:\s*")\d+\.\d+\.\d+(")/g;

const EXPECTED_BLOCK_PATTERN =
  /(const EXPECTED:\s*Record<string,\s*string>\s*=\s*\{)([\s\S]*?)(\n\};)/;

const PACKAGE_VERSION_PATTERN = /^(\s*"version"\s*:\s*")\d+\.\d+\.\d+(",?\s*)$/m;

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(SEMVER_CORE_PATTERN);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (!left || !right) {
    throw new Error(`Not a semver version: ${!left ? a : b}`);
  }

  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
}

function setPackageVersion(text: string, version: string): string {
  return text.replace(PACKAGE_VERSION_PATTERN, `$1${version}$2`);
}

function retargetStrataPins(text: string, version: string): string {
  return text.replace(STRATA_CARET_PIN_PATTERN, `$1^${version}$2`);
}

function setExpectedVersions(text: string, version: string): string {
  return text.replace(EXPECTED_BLOCK_PATTERN, (_all, open: string, body: string, close: string) => {
    return `${open}${body.replace(EXPECTED_ENTRY_PATTERN, `$1${version}$2`)}${close}`;
  });
}

const PUBLISHED_README_PATTERN = /Published as \*\*\d+\.\d+\.\d+\*\*/;

function setPublishedReadmeVersion(text: string, version: string): string {
  return text.replace(PUBLISHED_README_PATTERN, `Published as **${version}**`);
}

function insertChangelogEntry(text: string, version: string, notes = ""): string {
  if (new RegExp(`^##\\s+${version.replace(/\./g, "\\.")}\\s*$`, "m").test(text)) {
    return text;
  }

  const lines = text.split("\n");
  const titleIndex = lines.findIndex((line) => line.startsWith("# "));

  if (titleIndex === -1) {
    return `## ${version}\n\n${notes}\n\n${text}`;
  }

  const entry = notes ? `## ${version}\n\n${notes}\n` : `## ${version}\n\n`;
  lines.splice(titleIndex + 1, 0, "", entry.trimEnd());

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export {
  compareVersions,
  insertChangelogEntry,
  parseVersion,
  retargetStrataPins,
  setExpectedVersions,
  setPackageVersion,
  setPublishedReadmeVersion,
};
