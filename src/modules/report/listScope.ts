function htmlReportsWantsAll(request?: Request): boolean {
  if (!request) {
    return false;
  }

  return new URL(request.url).searchParams.get("all") === "1";
}

function htmlReportsHomePath(options: { all?: boolean; organizationId?: number }): string | null {
  if (options.all || options.organizationId === undefined) {
    return null;
  }

  return `/reports/organizations/${options.organizationId}`;
}

export { htmlReportsHomePath, htmlReportsWantsAll };
