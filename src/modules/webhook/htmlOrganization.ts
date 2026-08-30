import type { AuthUser } from "@getstrata/core/auth/authContext";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { resolveHtmlProjectListOrganizationId } from "../project/listScope";

interface CurrentOrganizationId {
  organization_id: number | null;
}

async function resolveHtmlWebhookOrganizationId(options: {
  form?: Record<string, unknown>;
  user?: AuthUser | null;
  currentForUser: (userId: number) => Promise<CurrentOrganizationId>;
}): Promise<number | undefined> {
  const form = options.form;

  if (form && Object.hasOwn(form, "organization_id")) {
    const raw = String(form.organization_id ?? "").trim();

    if (raw === "") {
      return undefined;
    }

    return parsePositiveIntParam(raw, "organization_id");
  }

  return await resolveHtmlProjectListOrganizationId({
    user: options.user,
    currentForUser: options.currentForUser,
  });
}

export { resolveHtmlWebhookOrganizationId };
