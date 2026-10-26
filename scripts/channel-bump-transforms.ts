import type { BumpTransforms } from "./bump.ts";
import type { ReleasePolicy } from "./release-policy.ts";

const VERSION = String.raw`\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?`;

function channelBumpTransforms(policy: ReleasePolicy): BumpTransforms {
  return {
    setPackageVersion: (text, version) =>
      text.replace(
        new RegExp(`^(\\s*"version"\\s*:\\s*")${VERSION}(",?\\s*)$`, "m"),
        `$1${version}$2`,
      ),
    retargetStrataPins: (text) =>
      text.replace(
        new RegExp(
          `("(?:@getstrata\\/[a-z-]+|create-strata)"[^\\n]{0,40}?")\\^?${VERSION}(")`,
          "g",
        ),
        `$1${policy.dependencyPin}$2`,
      ),
    setExpectedVersions: (text, version) =>
      text.replace(
        /(const EXPECTED:\s*Record<string,\s*string>\s*=\s*\{)([\s\S]*?)(\n\};)/,
        (_all, open: string, body: string, close: string) =>
          `${open}${body.replace(new RegExp(`("(?:@getstrata\\/[a-z-]+|create-strata)"\\s*:\\s*")${VERSION}(")`, "g"), `$1${version}$2`)}${close}`,
      ),
    setPublishedReadmeVersion: (text, version) =>
      text.replace(
        new RegExp(`Published as \\*\\*${VERSION}\\*\\*`),
        `Published as **${version}**`,
      ),
  };
}

export { channelBumpTransforms };
