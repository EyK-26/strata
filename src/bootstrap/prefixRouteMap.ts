function prefixRouteMap<Value = unknown>(
  prefix: string,
  routes: Record<string, Value>,
): Record<string, Value> {
  const normalizedPrefix = prefix.replace(/\/$/, "");
  const prefixed: Record<string, Value> = {};

  for (const [path, handler] of Object.entries(routes)) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    prefixed[`${normalizedPrefix}${normalizedPath}`] = handler;
  }

  return prefixed;
}

export { prefixRouteMap };
