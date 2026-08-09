function buildCacheKey(namespace: string, ...parts: Array<string | number>): string {
  if (parts.length === 0) {
    return namespace;
  }

  return `${namespace}:${parts.map(String).join(":")}`;
}

export { buildCacheKey };
