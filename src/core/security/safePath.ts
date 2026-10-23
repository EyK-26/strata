import { isAbsolute, resolve, sep } from "node:path";

function resolvePathUnderRoot(rootDirectory: string, path: string): string {
  if (path.length === 0) {
    throw new Error("Path must not be empty.");
  }

  if (path.includes("\0")) {
    throw new Error("Path must not contain a null byte.");
  }

  const root = resolve(rootDirectory);
  const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path.replace(/^\/+/u, ""));

  if (candidate === root || candidate.startsWith(`${root}${sep}`)) {
    return candidate;
  }

  throw new Error("Path escapes the storage root.");
}

function assertPathUnderRoot(rootDirectory: string, userPath: string): string {
  return resolvePathUnderRoot(rootDirectory, userPath.trim());
}

/** Map a URL pathname onto a document root. Leading slashes are not filesystem-absolute. */
function assertUrlPathUnderRoot(rootDirectory: string, urlPathname: string): string {
  return assertPathUnderRoot(rootDirectory, urlPathname.replace(/^\/+/u, ""));
}

export { assertPathUnderRoot, assertUrlPathUnderRoot };
