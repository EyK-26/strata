// Stable release policy only; prerelease channels require their own accepted policy.
const CANONICAL_STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type StableVersion = [number, number, number];

function parseStableVersion(value: string): StableVersion | null {
  const match = CANONICAL_STABLE_VERSION.exec(value);
  if (!match || match[0] !== value) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return [major, minor, patch];
}

export { parseStableVersion };
