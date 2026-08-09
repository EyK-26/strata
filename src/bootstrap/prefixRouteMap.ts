function prefixRouteMap(prefix: string, routes: Record<string, unknown>): Record<string, unknown> {
  const normalizedPrefix = prefix.replace(/\/$/, "");
  const prefixed: Record<string, unknown> = {};

  for (const [path, handler] of Object.entries(routes)) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    prefixed[`${normalizedPrefix}${normalizedPath}`] = handler;
  }

  return prefixed;
}

export { prefixRouteMap };
