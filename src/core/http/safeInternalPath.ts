const NESTED_REDIRECT_KEYS = new Set(["redirect", "next", "return", "returnTo", "return_to"]);

function looksLikeExternalTarget(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return true;
  }

  if (trimmed.includes("://") || trimmed.includes(":/") || trimmed.includes(":\\")) {
    return true;
  }

  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith("//") || decoded.includes("\\") || /https?:/i.test(decoded)) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
}

function sanitizeNestedQuery(search: string): string {
  if (!search) {
    return "";
  }

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const next = new URLSearchParams();

  for (const [key, value] of params.entries()) {
    if (NESTED_REDIRECT_KEYS.has(key)) {
      const sanitized = sanitizeInternalPath(value, "/");
      next.set(key, sanitized);
      continue;
    }

    if (looksLikeExternalTarget(value) && value.includes("://")) {
      continue;
    }

    next.set(key, value);
  }

  const serialized = next.toString();
  return serialized ? `?${serialized}` : "";
}

function sanitizeInternalPath(raw: string, fallback = "/"): string {
  const trimmed = raw.trim();

  if (looksLikeExternalTarget(trimmed)) {
    return fallback;
  }

  const queryIndex = trimmed.indexOf("?");
  const hashIndex = trimmed.indexOf("#");
  const end = [queryIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const pathname = end === undefined ? trimmed : trimmed.slice(0, end);

  if (looksLikeExternalTarget(pathname)) {
    return fallback;
  }

  const search =
    queryIndex >= 0 ? trimmed.slice(queryIndex, hashIndex >= 0 ? hashIndex : undefined) : "";
  return `${pathname}${sanitizeNestedQuery(search)}`;
}

function safeInternalRedirectPath(request: Request, fallback = "/"): string {
  const url = new URL(request.url);
  return sanitizeInternalPath(`${url.pathname}${url.search}`, fallback);
}

function loginRedirectLocation(request: Request): string {
  return `/login?redirect=${encodeURIComponent(safeInternalRedirectPath(request))}`;
}

export { loginRedirectLocation, safeInternalRedirectPath, sanitizeInternalPath };
