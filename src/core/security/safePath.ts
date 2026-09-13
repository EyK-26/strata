import { isAbsolute, resolve, sep } from "node:path";

function assertPathUnderRoot(rootDirectory: string, userPath: string): string {
  const trimmed = userPath.trim();

  if (trimmed.length === 0) {
    throw new Error("Path must not be empty.");
  }

  if (trimmed.includes("\0")) {
    throw new Error("Path must not contain a null byte.");
  }

  const root = resolve(rootDirectory);
  const candidate = isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(root, trimmed.replace(/^\/+/u, ""));

  if (candidate === root || candidate.startsWith(`${root}${sep}`)) {
    return candidate;
  }

  throw new Error("Path escapes the storage root.");
}

/** Map a URL pathname onto a document root. Leading slashes are not filesystem-absolute. */
function assertUrlPathUnderRoot(rootDirectory: string, urlPathname: string): string {
  return assertPathUnderRoot(rootDirectory, urlPathname.replace(/^\/+/u, ""));
}

export { assertPathUnderRoot, assertUrlPathUnderRoot };
