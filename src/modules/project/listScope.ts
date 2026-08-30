import { resolveUserId } from "@getstrata/core/auth/accessControl";
import type { AuthUser } from "@getstrata/core/auth/authContext";

interface CurrentOrganizationId {
  organization_id: number | null;
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

function htmlProjectListQuerySuffix(options: { organizationId?: number; status?: string }): string {
  const params = new URLSearchParams();

  if (options.organizationId !== undefined) {
    params.set("organizationId", String(options.organizationId));
  }

  if (options.status !== undefined && options.status !== "") {
    params.set("status", options.status);
  }

  const encoded = params.toString();

  return encoded === "" ? "" : `&${encoded}`;
}

export { htmlProjectListQuerySuffix, resolveHtmlProjectListOrganizationId };
