function requestPrefersJson(request?: Request): boolean {
  if (!request) {
    return true;
  }

  // Malformed wire authorities can leave Bun with a relative request URL. Never
  // turn an admission error into a second exception while selecting its format.
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return true;
  }

  if (request.headers.get("HX-Request") === "true") {
    return false;
  }
  if (pathname.startsWith("/api/")) {
    return true;
  }

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";

  if (accept.includes("text/html")) {
    return false;
  }

  if (accept.includes("application/json")) {
    return true;
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    return false;
  }

  return false;
}

export { requestPrefersJson };
