/** Declare the exact generated account handlers that need identifier-only policy. */
function matching(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      for (index++; index < source.length; index++) {
        if (source[index] === "\\") index++;
        else if (source[index] === quote) break;
      }
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2);
      if (index < 0) throw new Error("Unterminated generated auth comment.");
      index++;
      continue;
    }
    if (char === open) depth++;
    else if (char === close && --depth === 0) return index;
  }
  throw new Error("Unbalanced generated auth handler.");
}

export function portAuthRouteSource(input: string): string {
  let source = input;
  // The callback itself bears the trusted declaration; wrappers preserve its metadata.
  const callbacks = /async \(request, _ports\) => \{/g;
  for (let match = callbacks.exec(source); match; match = callbacks.exec(source)) {
    const open = source.indexOf("{", match.index);
    const end = matching(source, open, "{", "}");
    const body = source.slice(open, end + 1);
    if (
      /authServices\.(?:directory|session)|runWithLoginUser|runWithLockedAccount|runAuthWrite|createRegistration|issueSignedAuthMail|completeSigned|completeBrowserSsoLogin|enrollMfa/.test(
        body,
      )
    ) {
      source =
        source.slice(0, match.index) +
        "kernel.wrapIdentity(" +
        source.slice(match.index, end + 1) +
        ")" +
        source.slice(end + 1);
      callbacks.lastIndex = end + "kernel.wrapIdentity(".length + 2;
    } else callbacks.lastIndex = end + 1;
  }
  return source;
}
