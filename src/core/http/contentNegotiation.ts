function requestPrefersJson(request?: Request): boolean {
  if (!request) {
    return true;
  }

  if (request.headers.get("HX-Request") === "true") {
    return false;
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

  const pathname = new URL(request.url).pathname;

  return pathname.startsWith("/api/");
}

export { requestPrefersJson };
