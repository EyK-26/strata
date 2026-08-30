import { resolveUserId } from "@getstrata/core/auth/accessControl";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";

interface CurrentOrganizationId {
  organization_id: number | null;
}

function parseHtmlOrganizationIdQuery(request?: Request): number | undefined {
  if (!request) {
    return undefined;
  }

  const raw = new URL(request.url).searchParams.get("organizationId");

  if (raw === null || raw === "") {
    return undefined;
  }

  return parsePositiveIntParam(raw, "organizationId");
}

async function resolveHtmlProjectListOrganizationId(options: {
  queryOrganizationId?: number;
  user?: AuthUser | null;
  currentForUser: (userId: number) => Promise<CurrentOrganizationId>;
}): Promise<number | undefined> {
  if (options.queryOrganizationId !== undefined) {
    return options.queryOrganizationId;
  }

  if (!options.user) {
    return undefined;
  }

  const current = await options.currentForUser(resolveUserId(options.user));

  return current.organization_id ?? undefined;
}

function htmlProjectListQuerySuffix(options: {
  organizationId?: number;
  projectId?: number;
  status?: string;
}): string {
  const params = new URLSearchParams();

  if (options.organizationId !== undefined) {
    params.set("organizationId", String(options.organizationId));
  }

  if (options.projectId !== undefined) {
    params.set("projectId", String(options.projectId));
  }

  if (options.status !== undefined && options.status !== "") {
    params.set("status", options.status);
  }

  const encoded = params.toString();

  return encoded === "" ? "" : `&${encoded}`;
}

export {
  htmlProjectListQuerySuffix,
  parseHtmlOrganizationIdQuery,
  resolveHtmlProjectListOrganizationId,
};
