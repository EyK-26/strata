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

function sanitizeInternalPath(raw: string, fallback = "/"): string {
  if (looksLikeExternalTarget(raw)) {
    return fallback;
  }

  return raw;
}

function safeInternalRedirectPath(request: Request, fallback = "/"): string {
  const url = new URL(request.url);
  return sanitizeInternalPath(`${url.pathname}${url.search}`, fallback);
}

function loginRedirectLocation(request: Request): string {
  return `/login?redirect=${encodeURIComponent(safeInternalRedirectPath(request))}`;
}

export { loginRedirectLocation, safeInternalRedirectPath, sanitizeInternalPath };
