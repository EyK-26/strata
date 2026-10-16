function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Value (runtime) names declared by a .d.ts file. Type-only exports are ignored. */
function parseDeclaredValueExports(source: string): Set<string> {
  const names = new Set<string>();
  const text = stripComments(source);
  const typeOnly = new Set(
    [...text.matchAll(/(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1]),
  );
  const values = new Set(
    [...text.matchAll(/(?:class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g)].map(
      (match) => match[1],
    ),
  );
  const isValue = (name: string) => !typeOnly.has(name) || values.has(name);

  for (const match of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const declaredName = match[1];
    if (declaredName) {
      names.add(declaredName);
    }
  }

  for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    const exportedList = match[1];
    if (!exportedList) {
      continue;
    }

    for (const part of exportedList.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("type ")) {
        continue;
      }

      const aliasMatch = trimmed.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!aliasMatch) {
        continue;
      }

      const exportedName = aliasMatch[2] ?? aliasMatch[1];
      if (exportedName && isValue(aliasMatch[1] ?? "")) {
        names.add(exportedName);
      }
    }
  }

  for (const match of text.matchAll(
    /export\s+default\s+(?:abstract\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)/g,
  )) {
    const name = match[1];
    if (
      name &&
      name !== "interface" &&
      name !== "type" &&
      (name === "class" || name === "function" || isValue(name))
    )
      names.add("default");
  }
  return names;
}

export { parseDeclaredValueExports };
